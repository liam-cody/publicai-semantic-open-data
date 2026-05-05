import type { CKANDataset, LLMScore, RankedDataset } from '../types'
import { fieldAsPlainText } from './datasetText'
import { getNebiusConfig, nebiusChatCompletion } from './nebius'

/**
 * Rerank datasets using Nebius chat (OpenAI-compatible).
 * Sends the query + candidate metadata; expects JSON scores 0–10 per index.
 */
export async function rerankWithLLM(
  apiKey: string,
  query: string,
  datasets: CKANDataset[],
  options?: { baseUrl?: string; chatModel?: string }
): Promise<RankedDataset[]> {
  const env = getNebiusConfig()
  const cfg = {
    baseUrl: (options?.baseUrl ?? env.baseUrl).replace(/\/$/, ''),
    apiKey: apiKey || env.apiKey,
    chatModel: options?.chatModel ?? env.chatModel,
    embeddingModel: env.embeddingModel,
  }

  if (!cfg.apiKey.trim()) {
    throw new Error('Missing Nebius API key')
  }

  const candidates = datasets.map((d, i) => {
    const org = d.organization?.title ?? d.author ?? 'Unknown'
    const tags = (d.tags ?? [])
      .map((t) => t.display_name ?? t.name)
      .join(', ')
    const desc = fieldAsPlainText(d.notes as unknown).slice(0, 400)
    const title =
      fieldAsPlainText(d.title as unknown) || fieldAsPlainText(d.name as unknown) || d.name
    return { index: i, title, org, tags, desc }
  })

  const candidateBlock = candidates
    .map(
      (c) =>
        `[${c.index}]\nTitle: ${c.title}\nPublisher: ${c.org}\nTags: ${c.tags || '(none)'}\nDescription: ${c.desc || '(none)'}`
    )
    .join('\n\n')

  const prompt = `You are an expert assistant for the Austrian open data portal data.gv.at.

A user searched for: "${query}"

Below are ${candidates.length} datasets returned by a retrieval step. Your job is to rerank them by true semantic relevance to the user's query.

For each dataset:
- Assign a relevance score from 0 to 10 (10 = perfect match, 0 = completely unrelated)
- Write 2–3 sentences in GERMAN explaining specifically why this dataset is or isn't a good match — mention what it covers, how well it fits the query's geography/topic/granularity, and what is missing or off-topic
- Be honest: give genuinely low scores to off-topic results even if they share a keyword

Datasets:
${candidateBlock}

Respond ONLY with a raw JSON array — no markdown fences, no preamble, no trailing text:
[{"index":0,"score":8,"note":"..."},{"index":1,"score":2,"note":"..."},...]`

  const rawText = await nebiusChatCompletion(cfg, prompt, 6000)

  let scores: LLMScore[]
  try {
    const clean = rawText.replace(/```(?:json)?|```/g, '').trim()
    scores = JSON.parse(clean)
  } catch {
    // Recovery: response may be a truncated JSON array (token limit hit mid-object).
    // Salvage every complete object by finding the last "}," boundary and closing the array.
    const clean = rawText.replace(/```(?:json)?|```/g, '').trim()
    const lastClosingBrace = clean.lastIndexOf('},')
    if (lastClosingBrace !== -1) {
      try {
        scores = JSON.parse(clean.slice(0, lastClosingBrace + 1) + ']')
      } catch {
        throw new Error(`Could not parse LLM response as JSON.\n\nRaw response:\n${rawText.slice(0, 600)}`)
      }
    } else {
      throw new Error(`Could not parse LLM response as JSON.\n\nRaw response:\n${rawText.slice(0, 600)}`)
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
    .map((s) => {
      const d = datasets[s.index]
      return {
        ...d,
        org: candidates[s.index].org,
        llmScore: s.score,
        llmNote: typeof s.note === 'string' ? s.note : '',
        originalRank: s.index,
      }
    })
}
