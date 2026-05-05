import type { CKANDataset, RankedDataset, SearchStatus } from '../types'
import { ResultCard } from './ResultCard'

interface Props {
  label: string
  variant: 'ckan' | 'semantic' | 'lexical' | 'dense' | 'hybrid'
  status: SearchStatus
  statusMsg: string
  results: CKANDataset[] | RankedDataset[]
  error?: string
  showLLM?: boolean
  priorRankSource?: string
}

const LOADING_BAR_STYLE: React.CSSProperties = {
  height: 2,
  background: 'linear-gradient(90deg, #5b6af0, #f0955b)',
  borderRadius: 2,
  animation: 'slideBar 1.2s ease-in-out infinite',
  maxWidth: 200,
  margin: '0 auto 12px',
}

const VARIANT_STYLES: Record<
  Props['variant'],
  { accent: string; badgeBg: string; badgeBorder: string; badgeLabel: string }
> = {
  ckan: {
    accent: '#e05c5c',
    badgeBg: 'rgba(224,92,92,0.12)',
    badgeBorder: 'rgba(224,92,92,0.3)',
    badgeLabel: 'Keyword',
  },
  semantic: {
    accent: '#4ecb8d',
    badgeBg: 'rgba(78,203,141,0.12)',
    badgeBorder: 'rgba(78,203,141,0.3)',
    badgeLabel: 'LLM',
  },
  lexical: {
    accent: '#f0955b',
    badgeBg: 'rgba(240,149,91,0.12)',
    badgeBorder: 'rgba(240,149,91,0.3)',
    badgeLabel: 'BM25',
  },
  dense: {
    accent: '#6b8af7',
    badgeBg: 'rgba(107,138,247,0.12)',
    badgeBorder: 'rgba(107,138,247,0.3)',
    badgeLabel: 'Dense',
  },
  hybrid: {
    accent: '#5fd4d4',
    badgeBg: 'rgba(95,212,212,0.12)',
    badgeBorder: 'rgba(95,212,212,0.3)',
    badgeLabel: 'RRF',
  },
}

export function ResultsColumn({
  label,
  variant,
  status,
  statusMsg,
  results,
  error,
  showLLM,
  priorRankSource,
}: Props) {
  const isLoading = status === 'loading'
  const isEmpty = status === 'idle' || (status === 'done' && results.length === 0)
  const hasError = status === 'error'

  const vs = VARIANT_STYLES[variant]
  const accentColor = vs.accent
  const badgeBg = vs.badgeBg
  const badgeBorder = vs.badgeBorder
  const badgeLabel = vs.badgeLabel

  return (
    <div style={styles.wrapper}>
      {/* Column header */}
      <div style={styles.header}>
        <span
          style={{
            ...styles.badge,
            background: badgeBg,
            color: accentColor,
            border: `1px solid ${badgeBorder}`,
          }}
        >
          {badgeLabel}
        </span>
        <span style={styles.headerTitle}>{label}</span>
        {status !== 'idle' && (
          <span style={{ ...styles.statusText, color: hasError ? '#e05c5c' : '#4a4a55' }}>
            {statusMsg}
          </span>
        )}
      </div>

      {/* Results area */}
      <div style={styles.box}>
        {isLoading && (
          <div style={styles.stateMsg}>
            <div style={LOADING_BAR_STYLE} />
            {statusMsg}
          </div>
        )}

        {!isLoading && hasError && (
          <div style={styles.errorMsg}>{error ?? 'Unknown error'}</div>
        )}

        {!isLoading && !hasError && isEmpty && (
          <div style={styles.stateMsg}>
            {status === 'idle' ? 'Run a query to see results' : 'No results found'}
          </div>
        )}

        {!isLoading && !hasError && results.length > 0 &&
          results.map((d, i) => (
            <ResultCard
              key={d.id ?? d.name ?? i}
              dataset={d}
              rank={i + 1}
              showLLM={showLLM}
              priorRankSource={priorRankSource}
            />
          ))
        }
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderBottom: 'none',
    borderRadius: '8px 8px 0 0',
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: '3px 8px',
    borderRadius: 4,
    fontFamily: "'IBM Plex Mono', monospace",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 500,
    color: '#7a7a85',
    flex: 1,
  },
  statusText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    flexShrink: 0,
  },
  box: {
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: '0 0 8px 8px',
    minHeight: 300,
    maxHeight: 600,
    overflowY: 'auto' as const,
  },
  stateMsg: {
    padding: '40px 20px',
    textAlign: 'center' as const,
    color: '#3a3a44',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
  },
  errorMsg: {
    padding: 20,
    color: '#e05c5c',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
  },
}
