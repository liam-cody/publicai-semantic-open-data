import { useState, useRef, useMemo, type CSSProperties } from 'react'
import { searchCKAN } from './lib/ckan'
import { rerankWithLLM } from './lib/reranker'
import { getNebiusConfig } from './lib/nebius'
import { datasetToIndexText } from './lib/datasetText'
import { buildBm25Corpus, buildBm25Index, rankBm25 } from './lib/lexical'
import { reciprocalRankFusion } from './lib/rrf'
import { loadPublicEmbeddingIndex, embedQueryAndTopK } from './lib/embeddings'
import { ResultsColumn } from './components/ResultsColumn'
import { AgenticSearchTab } from './components/AgenticSearchTab'
import { MetadataGeneratorTab } from './components/MetadataGeneratorTab'
import type { CKANDataset, RankedDataset, SearchStatus } from './types'
import sampleDatasetsJson from './data/sample-datasets.json'
import './index.css'

const SAMPLE_DATASETS = sampleDatasetsJson as CKANDataset[]

/** Presets are Wien-focused — sample corpus covers the Vienna open data catalog. */
const PRESET_QUERIES = [
  'Bevölkerung nach Alter Wien',
  'Luftqualität Messstationen Wien',
  'Haltestellen öffentlicher Verkehr Wien',
  'Haushaltseinkommen Statistik Wien',
  'Wahlergebnisse Wien',
  'Kindergarten Standorte Wien',
  'Wasserqualität Wien',
  'Baugenehmigungen Wien',
]

const TOP_DISPLAY = 10
const TOP_FUSION = 40
const TOP_LLM_POOL = 20

type AppMode = 'live' | 'sample' | 'agentic' | 'metadata'

export default function App() {
  const [mode, setMode] = useState<AppMode>('live')
  const [query, setQuery] = useState('Bevölkerung nach Alter Wien')
  const [ckanStatus, setCkanStatus] = useState<SearchStatus>('idle')
  const [ckanMsg, setCkanMsg] = useState('')
  const [ckanResults, setCkanResults] = useState<CKANDataset[]>([])
  const [ckanError, setCkanError] = useState<string>()

  const [semStatus, setSemStatus] = useState<SearchStatus>('idle')
  const [semMsg, setSemMsg] = useState('')
  const [semResults, setSemResults] = useState<RankedDataset[]>([])
  const [semError, setSemError] = useState<string>()

  const [lexStatus, setLexStatus] = useState<SearchStatus>('idle')
  const [lexMsg, setLexMsg] = useState('')
  const [lexResults, setLexResults] = useState<CKANDataset[]>([])
  const [lexError, setLexError] = useState<string>()

  const [denseStatus, setDenseStatus] = useState<SearchStatus>('idle')
  const [denseMsg, setDenseMsg] = useState('')
  const [denseResults, setDenseResults] = useState<CKANDataset[]>([])
  const [denseError, setDenseError] = useState<string>()

  const [hybridStatus, setHybridStatus] = useState<SearchStatus>('idle')
  const [hybridMsg, setHybridMsg] = useState('')
  const [hybridResults, setHybridResults] = useState<CKANDataset[]>([])
  const [hybridError, setHybridError] = useState<string>()

  const [sampleSemStatus, setSampleSemStatus] = useState<SearchStatus>('idle')
  const [sampleSemMsg, setSampleSemMsg] = useState('')
  const [sampleSemResults, setSampleSemResults] = useState<RankedDataset[]>([])
  const [sampleSemError, setSampleSemError] = useState<string>()

  // Live CKAN results fetched in parallel during sample mode (for bottom comparison)
  const [compareQuery, setCompareQuery] = useState('')
  const [compareCkanStatus, setCompareCkanStatus] = useState<SearchStatus>('idle')
  const [compareCkanMsg, setCompareCkanMsg] = useState('')
  const [compareCkanResults, setCompareCkanResults] = useState<CKANDataset[]>([])
  const [compareCkanError, setCompareCkanError] = useState<string>()

  // Combined rerank: hybrid pool (sample) + live CKAN results → LLM
  const [combinedRerankStatus, setCombinedRerankStatus] = useState<SearchStatus>('idle')
  const [combinedRerankMsg, setCombinedRerankMsg] = useState('')
  const [combinedRerankResults, setCombinedRerankResults] = useState<RankedDataset[]>([])
  const [combinedRerankError, setCombinedRerankError] = useState<string>()

  const runningRef = useRef(false)

  const sampleTexts = useMemo(() => SAMPLE_DATASETS.map(datasetToIndexText), [])
  const sampleBm25 = useMemo(() => {
    const docs = buildBm25Corpus(sampleTexts)
    return { docs, index: buildBm25Index(docs) }
  }, [sampleTexts])

  async function run() {
    const q = query.trim()
    if (!q || runningRef.current) return
    const neb = getNebiusConfig()
    if (!neb.apiKey.trim()) {
      alert('Set VITE_NEBIUS_API_KEY in .env (see .env.example).')
      return
    }

    runningRef.current = true
    try {
      if (mode === 'live') {
        setCkanStatus('loading')
        setCkanMsg('fetching data.gv.at…')
        setCkanResults([])
        setCkanError(undefined)
        setSemStatus('loading')
        setSemMsg('waiting for Hub-Search (no embeddings in live mode)…')
        setSemResults([])
        setSemError(undefined)

        let datasets: CKANDataset[] = []
        try {
          datasets = await searchCKAN(q)
          setCkanStatus('done')
          setCkanMsg(`${datasets.length} result${datasets.length !== 1 ? 's' : ''}`)
          setCkanResults(datasets)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setCkanStatus('error')
          setCkanMsg('failed')
          setCkanError(msg)
          setSemStatus('error')
          setSemMsg('skipped')
          setSemError('Keyword search failed — nothing to rerank')
          return
        }

        if (!datasets.length) {
          setSemStatus('done')
          setSemMsg('nothing to rerank')
          return
        }

        setSemMsg('Nebius LLM reranking…')
        try {
          const reranked = await rerankWithLLM(neb.apiKey, q, datasets, {
            baseUrl: neb.baseUrl,
            chatModel: neb.chatModel,
          })
          setSemStatus('done')
          setSemMsg(`reranked ${reranked.length} result${reranked.length !== 1 ? 's' : ''}`)
          setSemResults(reranked)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setSemStatus('error')
          setSemMsg('failed')
          setSemError(msg)
        }
        return
      }

      // ── Sample lab mode ─────────────────────────────────────────────
      setLexStatus('loading')
      setLexMsg('BM25…')
      setLexResults([])
      setLexError(undefined)
      setDenseStatus('loading')
      setDenseMsg('loading precomputed vectors…')
      setDenseResults([])
      setDenseError(undefined)
      setHybridStatus('loading')
      setHybridMsg('RRF…')
      setHybridResults([])
      setHybridError(undefined)
      setSampleSemStatus('loading')
      setSampleSemMsg('waiting for dense + hybrid…')
      setSampleSemResults([])
      setSampleSemError(undefined)
      setCombinedRerankStatus('loading')
      setCombinedRerankMsg('waiting for hybrid + live results…')
      setCombinedRerankResults([])
      setCombinedRerankError(undefined)

      // Kick off live CKAN in parallel for the bottom comparison strip
      setCompareQuery(q)
      setCompareCkanStatus('loading')
      setCompareCkanMsg('fetching data.gv.at…')
      setCompareCkanResults([])
      setCompareCkanError(undefined)
      let ckanFetchedResults: CKANDataset[] = []
      const ckanPromise = searchCKAN(q)
        .then((r) => {
          ckanFetchedResults = r
          setCompareCkanStatus('done')
          setCompareCkanMsg(`${r.length} result${r.length !== 1 ? 's' : ''}`)
          setCompareCkanResults(r)
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e)
          setCompareCkanStatus('error')
          setCompareCkanMsg('failed')
          setCompareCkanError(msg)
        })

      try {
        const lexRanked = rankBm25(q, sampleBm25.docs, sampleBm25.index)
        const lexTop = lexRanked.slice(0, TOP_DISPLAY).map((r) => SAMPLE_DATASETS[r.id])
        setLexStatus('done')
        setLexMsg(`top ${lexTop.length} / ${SAMPLE_DATASETS.length} docs`)
        setLexResults(lexTop)

        const indexFile = await loadPublicEmbeddingIndex()
        if (indexFile.vectors.length !== SAMPLE_DATASETS.length) {
          throw new Error(
            `Embedding count ${indexFile.vectors.length} ≠ sample datasets ${SAMPLE_DATASETS.length}. Run npm run embed-sample.`
          )
        }

        setDenseMsg('Nebius query embedding…')
        const denseRanked = await embedQueryAndTopK(neb, q, indexFile, TOP_FUSION)
        const denseTop = denseRanked.slice(0, TOP_DISPLAY).map((r) => SAMPLE_DATASETS[r.index])
        setDenseStatus('done')
        setDenseMsg(`cosine top ${denseTop.length}`)
        setDenseResults(denseTop)

        const lexIds = lexRanked.slice(0, TOP_FUSION).map((r) => r.id)
        const denseIds = denseRanked.map((r) => r.index)
        const hybrid = reciprocalRankFusion([lexIds, denseIds], 60)
        const hybridTop = hybrid.slice(0, TOP_DISPLAY).map((h) => SAMPLE_DATASETS[h.id])
        setHybridStatus('done')
        setHybridMsg(`RRF top ${hybridTop.length}`)
        setHybridResults(hybridTop)

        const pool = hybrid.slice(0, TOP_LLM_POOL).map((h) => SAMPLE_DATASETS[h.id])
        setSampleSemMsg('Nebius LLM reranking…')
        const reranked = await rerankWithLLM(neb.apiKey, q, pool, {
          baseUrl: neb.baseUrl,
          chatModel: neb.chatModel,
        })
        setSampleSemStatus('done')
        setSampleSemMsg(`reranked ${reranked.length} (hybrid top ${TOP_LLM_POOL})`)
        setSampleSemResults(reranked)

        // Wait for live CKAN to settle, then build the combined pool
        await ckanPromise
        const seenIds = new Set<string>()
        const combinedPool: CKANDataset[] = []
        for (const d of pool) {
          if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedPool.push(d) }
        }
        for (const d of ckanFetchedResults) {
          if (!seenIds.has(d.id)) { seenIds.add(d.id); combinedPool.push(d) }
        }
        setCombinedRerankMsg(`LLM reranking combined pool (${combinedPool.length} candidates)…`)
        try {
          const combinedReranked = await rerankWithLLM(neb.apiKey, q, combinedPool, {
            baseUrl: neb.baseUrl,
            chatModel: neb.chatModel,
          })
          setCombinedRerankStatus('done')
          setCombinedRerankMsg(`reranked ${combinedReranked.length} (${pool.length} hybrid + ${ckanFetchedResults.length} live)`)
          setCombinedRerankResults(combinedReranked)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setCombinedRerankStatus('error')
          setCombinedRerankMsg('failed')
          setCombinedRerankError(msg)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setLexStatus('error')
        setLexMsg('failed')
        setLexError(msg)
        setDenseStatus('error')
        setDenseMsg('failed')
        setDenseError(msg)
        setHybridStatus('error')
        setHybridMsg('failed')
        setHybridError(msg)
        setSampleSemStatus('error')
        setSampleSemMsg('failed')
        setSampleSemError(msg)
        setCombinedRerankStatus('error')
        setCombinedRerankMsg('failed')
        setCombinedRerankError(msg)
      }
    } finally {
      runningRef.current = false
    }
  }

  const isRunning =
    mode === 'live'
      ? ckanStatus === 'loading' || semStatus === 'loading'
      : lexStatus === 'loading' ||
        denseStatus === 'loading' ||
        hybridStatus === 'loading' ||
        sampleSemStatus === 'loading' ||
        combinedRerankStatus === 'loading'

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Search Comparison</h1>
          <div style={s.subtitle}>
            data.gv.at · keyword / BM25 vs dense retrieval · Nebius LLM rerank
          </div>
        </div>
      </div>

      <div style={s.modeRow}>
        <span style={s.label}>Mode</span>
        <button
          type="button"
          style={{ ...s.modeBtn, ...(mode === 'live' ? s.modeBtnOn : {}) }}
          onClick={() => setMode('live')}
        >
          Live (Hub-Search)
        </button>
        <button
          type="button"
          style={{ ...s.modeBtn, ...(mode === 'sample' ? s.modeBtnOn : {}) }}
          onClick={() => setMode('sample')}
        >
          Sample catalog lab
        </button>
        <button
          type="button"
          style={{ ...s.modeBtn, ...(mode === 'agentic' ? s.modeBtnOn : {}) }}
          onClick={() => setMode('agentic')}
        >
          Agentic Search
        </button>
        <button
          type="button"
          style={{ ...s.modeBtn, ...(mode === 'metadata' ? s.modeBtnOn : {}) }}
          onClick={() => setMode('metadata')}
        >
          Metadata Generator
        </button>
        {mode === 'sample' && (
          <span style={s.sampleHint}>
            Fixed {SAMPLE_DATASETS.length} datasets · not the full portal index
          </span>
        )}
        {mode === 'agentic' && (
          <span style={s.sampleHint}>
            KI-gestützte Datensatzsuche · Live Hub-Search + Nebius LLM
          </span>
        )}
        {mode === 'metadata' && (
          <span style={s.sampleHint}>
            PDF upload · DCAT-AP.at v2.6 · data.gv.at standard
          </span>
        )}
      </div>

      {mode !== 'agentic' && mode !== 'metadata' && (
        <>
          <div style={s.queryBar}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="e.g. monthly income by district Austria"
              style={s.input}
            />
            <button type="button" onClick={run} disabled={isRunning} style={{ ...s.runBtn, opacity: isRunning ? 0.45 : 1 }}>
              {isRunning ? 'Running…' : 'Run'}
            </button>
          </div>

          <div style={s.pills}>
            {PRESET_QUERIES.map((pq) => (
              <button
                key={pq}
                type="button"
                style={{ ...s.pill, ...(query === pq ? s.pillActive : {}) }}
                onClick={() => setQuery(pq)}
              >
                {pq}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'agentic' && <AgenticSearchTab />}
      {mode === 'metadata' && <MetadataGeneratorTab />}

      {mode === 'live' ? (
        <div style={s.columns}>
          <ResultsColumn
            label="data.gv.at keyword search (Hub-Search)"
            variant="ckan"
            status={ckanStatus}
            statusMsg={ckanMsg}
            results={ckanResults}
            error={ckanError}
            showLLM={false}
          />
          <ResultsColumn
            label="Nebius LLM rerank + relevance notes"
            variant="semantic"
            status={semStatus}
            statusMsg={semMsg}
            results={semResults}
            error={semError}
            showLLM={true}
            priorRankSource="Hub-Search keyword order"
          />
        </div>
      ) : mode === 'sample' ? (
        <div style={s.sampleGrid}>
          <ResultsColumn
            label="Lexical (BM25) on sample"
            variant="lexical"
            status={lexStatus}
            statusMsg={lexMsg}
            results={lexResults}
            error={lexError}
            showLLM={false}
          />
          <ResultsColumn
            label="Dense (Nebius embeddings + cosine)"
            variant="dense"
            status={denseStatus}
            statusMsg={denseMsg}
            results={denseResults}
            error={denseError}
            showLLM={false}
          />
          <ResultsColumn
            label="Hybrid (RRF: BM25 + dense)"
            variant="hybrid"
            status={hybridStatus}
            statusMsg={hybridMsg}
            results={hybridResults}
            error={hybridError}
            showLLM={false}
          />
          <ResultsColumn
            label="Nebius LLM rerank (hybrid top 20)"
            variant="semantic"
            status={sampleSemStatus}
            statusMsg={sampleSemMsg}
            results={sampleSemResults}
            error={sampleSemError}
            showLLM={true}
            priorRankSource="hybrid pool"
          />
        </div>
      ) : null}

      {/* ── Bottom comparison strip (sample mode only) ──────────────── */}
      {mode === 'sample' && compareCkanStatus !== 'idle' && (
        <div style={s.compareSection}>
          <div style={s.compareHeading}>
            <span style={s.compareTitle}>Final results comparison</span>
            {compareQuery && (
              <span style={s.compareQueryBadge}>"{compareQuery}"</span>
            )}
            <span style={s.compareSubtitle}>
              LLM rerank of combined pool (sample hybrid + live Hub-Search) vs. raw Hub-Search
            </span>
          </div>
          <div style={s.compareGrid}>
            <ResultsColumn
              label="LLM rerank — Sample hybrid + Live Hub-Search combined"
              variant="semantic"
              status={combinedRerankStatus}
              statusMsg={combinedRerankMsg}
              results={combinedRerankResults}
              error={combinedRerankError}
              showLLM={true}
              priorRankSource="combined pool"
            />
            <ResultsColumn
              label="Live Hub-Search (data.gv.at full catalog, unranked)"
              variant="ckan"
              status={compareCkanStatus}
              statusMsg={compareCkanMsg}
              results={compareCkanResults}
              error={compareCkanError}
              showLLM={false}
            />
          </div>
        </div>
      )}

      <div style={s.note}>
        <strong>Live:</strong> data.gv.at <code>Hub-Search</code> (<code>/api/hub/search/search</code>) · dev proxy or direct HTTPS · then Nebius chat reranks the same hits.
        <br />
        <strong>Sample lab:</strong> BM25 + committed vectors (<code>public/sample-embeddings.json</code>) + RRF + Nebius
        query embedding &amp; rerank. Presets and BM25 are <strong>German-first</strong> (portal metadata is mostly DE).
        <br />
        <strong>Real sample data:</strong> In dev, use the export button above, replace{' '}
        <code>src/data/sample-datasets.json</code>, then run <code>npm run embed-sample</code>.
        <br />
        Smoke test: <code>npm run smoke-nebius</code>.
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    background: '#0f0f10',
    color: '#e8e8ec',
    minHeight: '100vh',
    padding: '28px 24px',
    maxWidth: 1480,
    margin: '0 auto',
  },
  header: { marginBottom: 16 },
  h1: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#7a7a85',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: '#4a4a55',
  },
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  modeBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid #2e2e34',
    background: '#19191c',
    color: '#7a7a85',
    cursor: 'pointer',
  },
  modeBtnOn: {
    borderColor: '#5b6af0',
    color: '#5b6af0',
    background: 'rgba(91,106,240,0.1)',
  },
  sampleHint: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#5fd4d4',
  },
  label: { fontSize: 12, color: '#7a7a85', fontWeight: 500, whiteSpace: 'nowrap' },
  queryBar: { display: 'flex', gap: 8, marginBottom: 8 },
  input: {
    flex: 1,
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 6,
    color: '#e8e8ec',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    padding: '9px 14px',
    outline: 'none',
  },
  runBtn: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    background: '#5b6af0',
    color: '#fff',
    padding: '9px 22px',
    border: 'none',
    borderRadius: 6,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  pills: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 },
  pill: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 20,
    border: '1px solid #2e2e34',
    background: '#19191c',
    color: '#7a7a85',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  pillActive: {
    borderColor: '#5b6af0',
    background: 'rgba(91,106,240,0.12)',
    color: '#5b6af0',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 16,
  },
  sampleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 16,
  },
  note: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 6,
    padding: '8px 14px',
    lineHeight: 1.7,
    marginTop: 16,
  },
  compareSection: {
    marginBottom: 16,
    borderTop: '1px solid #2e2e34',
    paddingTop: 20,
  },
  compareHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap' as const,
  },
  compareTitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#5b6af0',
  },
  compareQueryBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#e8e8ec',
    background: 'rgba(91,106,240,0.12)',
    border: '1px solid rgba(91,106,240,0.3)',
    borderRadius: 4,
    padding: '2px 8px',
  },
  compareSubtitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },
  compareGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
}
