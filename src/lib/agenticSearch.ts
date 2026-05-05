import type { CKANDataset, QueryDecomposition, AgenticProposal } from '../types'
import type { NebiusClientConfig } from './nebius'
import { nebiusChatCompletion } from './nebius'
import { fieldAsPlainText } from './datasetText'

/**
 * Step 1: Ask the LLM to decompose the user's free-form description into
 * 3–5 focused sub-queries + a plain-language summary of the data need.
 */
export async function decomposeQuery(
  cfg: NebiusClientConfig,
  description: string
): Promise<QueryDecomposition> {
  const prompt = `Du bist ein Experte für das österreichische Open-Data-Portal data.gv.at.

Ein Benutzer möchte Datensätze finden und hat sein Anliegen wie folgt beschrieben:
"${description}"

Deine Aufgabe:
1. Fasse in 1–2 Sätzen auf Deutsch zusammen, welche Art von Daten der Benutzer benötigt.
2. Leite 3–5 konkrete Suchanfragen (auf Deutsch) ab, die zusammen den Bedarf des Benutzers abdecken. Jede Suchanfrage sollte einen anderen Aspekt adressieren.

Antworte NUR mit einem rohen JSON-Objekt — keine Markdown-Fences, keine Einleitung:
{"summary":"...","subqueries":[{"query":"...","rationale":"..."},...]}`

  const raw = await nebiusChatCompletion(cfg, prompt, 1000)
  const clean = raw.replace(/```(?:json)?|```/g, '').trim()

  let parsed: QueryDecomposition
  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(`Could not parse decomposition response as JSON.\n\nRaw:\n${raw.slice(0, 600)}`)
  }

  if (!Array.isArray(parsed.subqueries) || parsed.subqueries.length === 0) {
    throw new Error('Decomposition returned no sub-queries.')
  }

  return parsed
}

/**
 * Step 3: Given the original description and all deduplicated candidate datasets,
 * ask the LLM to rank them and explain how each one fits the user's need.
 * Returns proposals sorted by score descending.
 */
export async function synthesizeProposals(
  cfg: NebiusClientConfig,
  description: string,
  datasets: CKANDataset[],
  datasetToSubqueries: Map<string, string[]>
): Promise<AgenticProposal[]> {
  if (datasets.length === 0) return []

  const candidates = datasets.map((d, i) => {
    const org = d.organization?.title ?? d.author ?? 'Unknown'
    const tags = (d.tags ?? []).map((t) => t.display_name ?? t.name).join(', ')
    const desc = fieldAsPlainText(d.notes as unknown).slice(0, 400)
    const title = fieldAsPlainText(d.title as unknown) || d.name
    return { index: i, title, org, tags, desc }
  })

  const candidateBlock = candidates
    .map(
      (c) =>
        `[${c.index}]\nTitel: ${c.title}\nHerausgeber: ${c.org}\nTags: ${c.tags || '(keine)'}\nBeschreibung: ${c.desc || '(keine)'}`
    )
    .join('\n\n')

  const prompt = `Du bist ein Experte für das österreichische Open-Data-Portal data.gv.at.

Ein Benutzer hat folgendes Datenanliegen beschrieben:
"${description}"

Unten findest du ${candidates.length} Datensätze, die durch eine automatische Suche gefunden wurden. Deine Aufgabe:
- Weise jedem Datensatz einen Relevanz-Score von 0 bis 10 zu (10 = perfekte Übereinstimmung, 0 = völlig unpassend)
- Schreibe 2–3 Sätze auf Deutsch, die erklären, warum dieser Datensatz für das Anliegen des Benutzers geeignet oder ungeeignet ist
- Sei ehrlich: Gib wirklich niedrige Scores für irrelevante Ergebnisse

Datensätze:
${candidateBlock}

Antworte NUR mit einem rohen JSON-Array — keine Markdown-Fences, keine Einleitung:
[{"index":0,"score":8,"note":"..."},{"index":1,"score":2,"note":"..."},...]`

  const raw = await nebiusChatCompletion(cfg, prompt, 6000)

  let scores: Array<{ index: number; score: number; note: string }>
  try {
    const clean = raw.replace(/```(?:json)?|```/g, '').trim()
    scores = JSON.parse(clean)
  } catch {
    const clean = raw.replace(/```(?:json)?|```/g, '').trim()
    const lastBrace = clean.lastIndexOf('},')
    if (lastBrace !== -1) {
      try {
        scores = JSON.parse(clean.slice(0, lastBrace + 1) + ']')
      } catch {
        throw new Error(`Could not parse synthesis response as JSON.\n\nRaw:\n${raw.slice(0, 600)}`)
      }
    } else {
      throw new Error(`Could not parse synthesis response as JSON.\n\nRaw:\n${raw.slice(0, 600)}`)
    }
  }

  return scores
    .filter(
      (s) =>
        typeof s.index === 'number' &&
        Number.isFinite(s.index) &&
        s.index >= 0 &&
        s.index < datasets.length &&
        typeof s.score === 'number'
    )
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      ...datasets[s.index],
      llmScore: s.score,
      llmNote: typeof s.note === 'string' ? s.note : '',
      matchedSubqueries: datasetToSubqueries.get(datasets[s.index].id) ?? [],
    }))
}
