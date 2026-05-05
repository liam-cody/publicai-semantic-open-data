import type { CKANDataset, RankedDataset } from '../types'
import { fieldAsPlainText } from '../lib/datasetText'

interface Props {
  dataset: CKANDataset | RankedDataset
  rank: number          // 1-based display rank
  showLLM?: boolean     // show LLM score + note + rank delta
  /** Label for the pre-rerank ordering (e.g. "Hub-Search keyword order", "hybrid pool") */
  priorRankSource?: string
}

function isRanked(d: CKANDataset | RankedDataset): d is RankedDataset {
  return 'llmScore' in d
}

export function ResultCard({ dataset, rank, showLLM = false, priorRankSource = 'Hub-Search keyword order' }: Props) {
  const title =
    fieldAsPlainText(dataset.title as unknown) ||
    fieldAsPlainText(dataset.name as unknown) ||
    '(untitled)'
  const org = isRanked(dataset)
    ? dataset.org
    : fieldAsPlainText(dataset.organization?.title as unknown) ||
      dataset.author ||
      '—'
  const desc = fieldAsPlainText(dataset.notes as unknown)
  const sparseMetadata = !desc || desc.trim().length < 30
  const id = dataset.id ?? dataset.name ?? ''
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  )
  const datasetUrl = isUuid
    ? `https://www.data.gv.at/katalog/datasets/${id}`
    : `https://www.data.gv.at/katalog/dataset/${dataset.name ?? dataset.id}`

  let rankDelta: number | null = null
  if (showLLM && isRanked(dataset)) {
    rankDelta = dataset.originalRank - (rank - 1) // positive = moved up
  }

  return (
    <div style={styles.card}>
      {/* Rank row */}
      <div style={styles.rankRow}>
        <span style={styles.rankNum}>#{rank}</span>
        {showLLM && isRanked(dataset) && (
          <>
            <span style={{ ...styles.originalRank }}>
              was #{dataset.originalRank + 1} in {priorRankSource}
            </span>
            {rankDelta !== null && rankDelta !== 0 && (
              <span
                style={{
                  ...styles.deltaBadge,
                  ...(rankDelta > 0 ? styles.deltaUp : styles.deltaDown),
                }}
              >
                {rankDelta > 0 ? `↑${rankDelta}` : `↓${Math.abs(rankDelta)}`}
              </span>
            )}
          </>
        )}
      </div>

      {/* Title */}
      <div style={styles.title}>
        <a href={datasetUrl} target="_blank" rel="noreferrer" style={styles.titleLink}>
          {title}
        </a>
      </div>

      {/* Publisher */}
      <div style={styles.org}>{org}</div>

      {/* Description */}
      <div style={styles.desc}>
        {desc ? (
          desc.length > 200 ? desc.slice(0, 200) + '…' : desc
        ) : (
          <em style={{ color: '#3a3a4a' }}>No description provided</em>
        )}
      </div>

      {/* Badges */}
      <div style={styles.badgeRow}>
        {sparseMetadata && (
          <span style={{ ...styles.badge, ...styles.badgeSparse }}>sparse metadata</span>
        )}
        {showLLM && isRanked(dataset) && (
          <span style={{ ...styles.badge, ...styles.badgeScore }}>
            relevance {dataset.llmScore}/10
          </span>
        )}
      </div>

      {/* LLM Note */}
      {showLLM && isRanked(dataset) && dataset.llmNote && (
        <div style={styles.llmNote}>{dataset.llmNote}</div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: '12px 14px',
    borderBottom: '1px solid #2e2e34',
    transition: 'background 0.1s',
  },
  rankRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  rankNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#3a3a4a',
  },
  originalRank: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#3a3a4a',
  },
  deltaBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
  },
  deltaUp: {
    background: 'rgba(78,203,141,0.12)',
    color: '#4ecb8d',
    border: '1px solid rgba(78,203,141,0.25)',
  },
  deltaDown: {
    background: 'rgba(224,92,92,0.1)',
    color: '#e05c5c',
    border: '1px solid rgba(224,92,92,0.25)',
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
  badgeRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 3,
    display: 'inline-block',
  },
  badgeSparse: {
    background: 'rgba(224,92,92,0.08)',
    color: '#e05c5c',
    border: '1px solid rgba(224,92,92,0.2)',
  },
  badgeScore: {
    background: 'rgba(78,203,141,0.1)',
    color: '#4ecb8d',
    border: '1px solid rgba(78,203,141,0.2)',
  },
  llmNote: {
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
