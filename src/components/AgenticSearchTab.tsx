import { useState, useRef, type CSSProperties } from 'react'
import type { CKANDataset, QueryDecomposition, SubQuery, AgenticProposal, SearchStatus } from '../types'
import { getNebiusConfig } from '../lib/nebius'
import { searchCKAN } from '../lib/ckan'
import { decomposeQuery, synthesizeProposals } from '../lib/agenticSearch'
import { fieldAsPlainText } from '../lib/datasetText'

const EXAMPLE_PROMPTS = [
  'Ich möchte die Pendlerströme in Wien mit der Luftverschmutzung vergleichen — welche Datensätze gibt es dafür?',
  'Ich analysiere die Entwicklung von Schulstandorten und Schülerzahlen in Wien.',
  'Ich brauche Daten zu Wasserqualität, Niederschlag und Klimaentwicklung für eine Umweltstudie in Wien.',
  'Ich suche Datensätze zur wirtschaftlichen Lage von Haushalten, Einkommen und Armutsgefährdung in Wien.',
]

interface SubQueryState {
  subquery: SubQuery
  status: SearchStatus
  count: number
  error?: string
}

export function AgenticSearchTab() {
  const [description, setDescription] = useState('')
  const [running, setRunning] = useState(false)

  // Step 1 state
  const [step1Status, setStep1Status] = useState<SearchStatus>('idle')
  const [decomposition, setDecomposition] = useState<QueryDecomposition | null>(null)
  const [step1Error, setStep1Error] = useState<string>()

  // Step 2 state
  const [subQueryStates, setSubQueryStates] = useState<SubQueryState[]>([])

  // Step 3 state
  const [step3Status, setStep3Status] = useState<SearchStatus>('idle')
  const [proposals, setProposals] = useState<AgenticProposal[]>([])
  const [totalCandidates, setTotalCandidates] = useState(0)
  const [step3Error, setStep3Error] = useState<string>()

  const runningRef = useRef(false)

  function reset() {
    setStep1Status('idle')
    setDecomposition(null)
    setStep1Error(undefined)
    setSubQueryStates([])
    setStep3Status('idle')
    setProposals([])
    setTotalCandidates(0)
    setStep3Error(undefined)
  }

  async function run() {
    const desc = description.trim()
    if (!desc || runningRef.current) return
    const neb = getNebiusConfig()
    if (!neb.apiKey.trim()) {
      alert('Set VITE_NEBIUS_API_KEY in .env (see .env.example).')
      return
    }

    runningRef.current = true
    setRunning(true)
    reset()

    try {
      // ── Step 1: decompose ─────────────────────────────────────────────────
      setStep1Status('loading')
      let decomp: QueryDecomposition
      try {
        decomp = await decomposeQuery(neb, desc)
        setDecomposition(decomp)
        setStep1Status('done')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setStep1Status('error')
        setStep1Error(msg)
        return
      }

      // ── Step 2: parallel retrieval per sub-query ──────────────────────────
      const initialStates: SubQueryState[] = decomp.subqueries.map((sq) => ({
        subquery: sq,
        status: 'loading',
        count: 0,
      }))
      setSubQueryStates(initialStates)

      // dataset id → sub-queries that surfaced it
      const datasetMap = new Map<string, CKANDataset>()
      const datasetToSubqueries = new Map<string, string[]>()

      await Promise.all(
        decomp.subqueries.map(async (sq, idx) => {
          try {
            const results = await searchCKAN(sq.query)
            for (const d of results) {
              if (!datasetMap.has(d.id)) datasetMap.set(d.id, d)
              const existing = datasetToSubqueries.get(d.id) ?? []
              if (!existing.includes(sq.query)) existing.push(sq.query)
              datasetToSubqueries.set(d.id, existing)
            }
            setSubQueryStates((prev) =>
              prev.map((s, i) =>
                i === idx ? { ...s, status: 'done', count: results.length } : s
              )
            )
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setSubQueryStates((prev) =>
              prev.map((s, i) =>
                i === idx ? { ...s, status: 'error', error: msg } : s
              )
            )
          }
        })
      )

      const allDatasets = [...datasetMap.values()]
      setTotalCandidates(allDatasets.length)

      if (allDatasets.length === 0) {
        setStep3Status('done')
        return
      }

      // ── Step 3: synthesize + rank ─────────────────────────────────────────
      setStep3Status('loading')
      try {
        const result = await synthesizeProposals(neb, desc, allDatasets, datasetToSubqueries)
        setProposals(result)
        setStep3Status('done')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setStep3Status('error')
        setStep3Error(msg)
      }
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  const hasStarted = step1Status !== 'idle'

  return (
    <div style={s.root}>
      {/* Input area */}
      <div style={s.inputSection}>
        <label style={s.inputLabel}>
          Beschreibe dein Anliegen oder welche Daten du benötigst
        </label>
        <div style={s.inputRow}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="z. B. Ich möchte die Verkehrsdaten in Wien mit der Luftqualität vergleichen, um Pendlerströme und deren Einfluss auf die Umwelt zu analysieren."
            style={s.textarea}
            rows={4}
            disabled={running}
          />
          <button
            type="button"
            onClick={run}
            disabled={running || !description.trim()}
            style={{ ...s.analyzeBtn, opacity: running || !description.trim() ? 0.45 : 1 }}
          >
            {running ? 'Analysiere…' : 'Analyze & Find'}
          </button>
        </div>

        {/* Example prompts */}
        {!hasStarted && (
          <div style={s.examples}>
            <span style={s.examplesLabel}>Beispiele:</span>
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                style={{ ...s.examplePill, ...(description === p ? s.examplePillActive : {}) }}
                onClick={() => setDescription(p)}
                disabled={running}
              >
                {p.length > 60 ? p.slice(0, 60) + '…' : p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Steps */}
      {hasStarted && (
        <div style={s.steps}>
          {/* ── Step 1 ── */}
          <StepPanel
            number={1}
            title="Analyse deines Anliegens"
            status={step1Status}
          >
            {step1Status === 'loading' && (
              <span style={s.stepHint}>KI analysiert dein Anliegen und leitet Suchanfragen ab…</span>
            )}
            {step1Status === 'error' && (
              <span style={s.errorText}>{step1Error}</span>
            )}
            {step1Status === 'done' && decomposition && (
              <div>
                <p style={s.summary}>{decomposition.summary}</p>
                <div style={s.subqueryPills}>
                  {decomposition.subqueries.map((sq) => (
                    <span key={sq.query} style={s.subqueryPill} title={sq.rationale}>
                      {sq.query}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </StepPanel>

          {/* ── Step 2 ── */}
          {subQueryStates.length > 0 && (
            <StepPanel
              number={2}
              title="Suche im Datenkatalog"
              status={subQueryStates.every((s) => s.status === 'done' || s.status === 'error') ? 'done' : 'loading'}
            >
              <div style={s.subqueryList}>
                {subQueryStates.map((sq) => (
                  <div key={sq.subquery.query} style={s.subqueryRow}>
                    <StatusDot status={sq.status} />
                    <span style={s.subqueryQueryText}>{sq.subquery.query}</span>
                    {sq.status === 'done' && (
                      <span style={s.subqueryCount}>{sq.count} Ergebnisse</span>
                    )}
                    {sq.status === 'error' && (
                      <span style={s.errorText}>Fehler</span>
                    )}
                    {sq.status === 'loading' && (
                      <span style={s.stepHint}>sucht…</span>
                    )}
                  </div>
                ))}
              </div>
            </StepPanel>
          )}

          {/* ── Step 3 ── */}
          {step3Status !== 'idle' && (
            <StepPanel
              number={3}
              title={
                step3Status === 'done' && proposals.length > 0
                  ? `Vorgeschlagene Datensätze (${proposals.length} von ${totalCandidates} Kandidaten bewertet)`
                  : step3Status === 'done'
                  ? 'Keine passenden Datensätze gefunden'
                  : `Synthese (${totalCandidates} einzigartige Kandidaten)…`
              }
              status={step3Status}
            >
              {step3Status === 'loading' && (
                <span style={s.stepHint}>KI bewertet alle gefundenen Datensätze gegen dein Anliegen…</span>
              )}
              {step3Status === 'error' && (
                <span style={s.errorText}>{step3Error}</span>
              )}
              {step3Status === 'done' && proposals.length > 0 && (
                <div style={s.proposalList}>
                  {proposals.map((p, idx) => (
                    <ProposalCard key={p.id} proposal={p} rank={idx + 1} />
                  ))}
                </div>
              )}
            </StepPanel>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepPanel({
  number,
  title,
  status,
  children,
}: {
  number: number
  title: string
  status: SearchStatus
  children?: React.ReactNode
}) {
  return (
    <div style={sp.panel}>
      <div style={sp.header}>
        <span style={sp.stepNum}>Schritt {number}</span>
        <StatusDot status={status} />
        <span style={sp.title}>{title}</span>
      </div>
      <div style={sp.body}>{children}</div>
    </div>
  )
}

function StatusDot({ status }: { status: SearchStatus }) {
  const colors: Record<SearchStatus, string> = {
    idle: '#3a3a4a',
    loading: '#f0b429',
    done: '#4ecb8d',
    error: '#e05c5c',
  }
  const label: Record<SearchStatus, string> = {
    idle: '',
    loading: '⟳',
    done: '✓',
    error: '✕',
  }
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        color: colors[status],
        minWidth: 14,
        display: 'inline-block',
        textAlign: 'center',
      }}
    >
      {label[status]}
    </span>
  )
}

function ProposalCard({ proposal, rank }: { proposal: AgenticProposal; rank: number }) {
  const title =
    fieldAsPlainText(proposal.title as unknown) ||
    fieldAsPlainText(proposal.name as unknown) ||
    '(untitled)'
  const org =
    fieldAsPlainText(proposal.organization?.title as unknown) ||
    proposal.author ||
    '—'
  const desc = fieldAsPlainText(proposal.notes as unknown)
  const id = proposal.id ?? proposal.name ?? ''
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  const url = isUuid
    ? `https://www.data.gv.at/katalog/datasets/${id}`
    : `https://www.data.gv.at/katalog/dataset/${proposal.name ?? proposal.id}`

  const scoreColor =
    proposal.llmScore >= 7
      ? '#4ecb8d'
      : proposal.llmScore >= 4
      ? '#f0b429'
      : '#e05c5c'

  return (
    <div style={pc.card}>
      <div style={pc.topRow}>
        <span style={pc.rank}>#{rank}</span>
        <span style={{ ...pc.score, color: scoreColor, borderColor: `${scoreColor}44`, background: `${scoreColor}14` }}>
          {proposal.llmScore}/10
        </span>
        {proposal.matchedSubqueries.map((q) => (
          <span key={q} style={pc.matchedTag}>{q}</span>
        ))}
      </div>
      <div style={pc.title}>
        <a href={url} target="_blank" rel="noreferrer" style={pc.titleLink}>
          {title}
        </a>
      </div>
      <div style={pc.org}>{org}</div>
      {desc && (
        <div style={pc.desc}>
          {desc.length > 200 ? desc.slice(0, 200) + '…' : desc}
        </div>
      )}
      {proposal.llmNote && (
        <div style={pc.note}>{proposal.llmNote}</div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  inputSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  inputLabel: {
    fontSize: 12,
    color: '#7a7a85',
    fontWeight: 500,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  textarea: {
    flex: 1,
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 6,
    color: '#e8e8ec',
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 13,
    padding: '10px 14px',
    outline: 'none',
    resize: 'vertical',
    lineHeight: 1.55,
  },
  analyzeBtn: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    background: '#5b6af0',
    color: '#fff',
    padding: '10px 22px',
    border: 'none',
    borderRadius: 6,
    whiteSpace: 'nowrap',
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  examples: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  examplesLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
    whiteSpace: 'nowrap' as const,
  },
  examplePill: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 20,
    border: '1px solid #2e2e34',
    background: '#19191c',
    color: '#7a7a85',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  examplePillActive: {
    borderColor: '#5b6af0',
    background: 'rgba(91,106,240,0.12)',
    color: '#5b6af0',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  stepHint: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },
  errorText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#e05c5c',
  },
  summary: {
    fontSize: 12,
    color: '#a0a0b0',
    marginBottom: 10,
    lineHeight: 1.55,
  },
  subqueryPills: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  subqueryPill: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 20,
    border: '1px solid rgba(91,106,240,0.4)',
    background: 'rgba(91,106,240,0.1)',
    color: '#8a96f5',
    cursor: 'default',
  },
  subqueryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  subqueryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  subqueryQueryText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: '#c8c8d4',
    flex: 1,
  },
  subqueryCount: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4ecb8d',
  },
  proposalList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    border: '1px solid #2e2e34',
    borderRadius: 6,
    overflow: 'hidden',
  },
}

const sp: Record<string, CSSProperties> = {
  panel: {
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 6,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderBottom: '1px solid #2e2e34',
    background: '#111114',
  },
  stepNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#4a4a55',
  },
  title: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#9a9aaa',
    fontWeight: 500,
  },
  body: {
    padding: '12px 14px',
  },
}

const pc: Record<string, CSSProperties> = {
  card: {
    padding: '12px 14px',
    borderBottom: '1px solid #2e2e34',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
    flexWrap: 'wrap' as const,
  },
  rank: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#3a3a4a',
  },
  score: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    padding: '1px 7px',
    borderRadius: 3,
    border: '1px solid',
    fontWeight: 600,
  },
  matchedTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    padding: '1px 7px',
    borderRadius: 3,
    border: '1px solid rgba(91,106,240,0.3)',
    background: 'rgba(91,106,240,0.08)',
    color: '#8a96f5',
  },
  title: {
    fontSize: 13,
    fontWeight: 500,
    color: '#e8e8ec',
    marginBottom: 3,
    lineHeight: 1.4,
  },
  titleLink: {
    color: 'inherit',
    textDecoration: 'none',
  },
  org: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#7a7a85',
    marginBottom: 5,
  },
  desc: {
    fontSize: 12,
    color: '#6a6a75',
    lineHeight: 1.55,
    marginBottom: 6,
  },
  note: {
    marginTop: 6,
    fontSize: 11,
    color: '#4ecb8d',
    fontFamily: "'IBM Plex Mono', monospace",
    padding: '4px 8px',
    background: 'rgba(78,203,141,0.07)',
    borderLeft: '2px solid #4ecb8d',
    borderRadius: '0 3px 3px 0',
    lineHeight: 1.5,
  },
}
