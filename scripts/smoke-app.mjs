/**
 * End-to-end smoke: Hub-Search queries + optional Nebius (embeddings + chat).
 * Loads `.env` like Vite does for the browser.
 *
 *   node scripts/smoke-app.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotenv } from './load-dotenv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

loadDotenv(root)

const HUB =
  process.env.SMOKE_HUB_BASE?.replace(/\/$/, '') ||
  'https://www.data.gv.at/api/hub/search/search'
const KEY = process.env.NEBIUS_API_KEY || process.env.VITE_NEBIUS_API_KEY || ''
const BASE =
  process.env.NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  process.env.VITE_NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  'https://api.tokenfactory.nebius.com/v1'
const CHAT =
  process.env.NEBIUS_CHAT_MODEL ||
  process.env.VITE_NEBIUS_CHAT_MODEL ||
  'meta-llama/Llama-3.3-70B-Instruct'
const EMB =
  process.env.NEBIUS_EMBEDDING_MODEL ||
  process.env.VITE_NEBIUS_EMBEDDING_MODEL ||
  'Qwen/Qwen3-Embedding-8B'

const QUERIES = [
  'Bevölkerung nach Alter Wien',
  'Luftqualität Messstationen Österreich',
  'Haltestellen öffentlicher Verkehr Graz',
]

async function hubOnce(q) {
  const params = new URLSearchParams({ filters: 'dataset', limit: '5', page: '0' })
  if (q.trim()) params.set('q', q.trim())
  const r = await fetch(`${HUB}?${params}`, { headers: { Accept: 'application/json' } })
  const t = await r.text()
  if (!r.ok) throw new Error(`Hub HTTP ${r.status}: ${t.slice(0, 200)}`)
  const j = JSON.parse(t)
  const n = j.result?.results?.length ?? 0
  if (n < 1) throw new Error(`Hub empty results for q=${JSON.stringify(q)}`)
  return n
}

async function main() {
  for (const q of QUERIES) {
    const n = await hubOnce(q)
    console.log(`Hub OK  q=${q.slice(0, 40)}…  hits=${n}`)
  }

  const samplePath = path.join(root, 'src', 'data', 'sample-datasets.json')
  const embPath = path.join(root, 'public', 'sample-embeddings.json')
  const { readFileSync } = await import('node:fs')
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'))
  const emb = JSON.parse(readFileSync(embPath, 'utf8'))
  if (sample.length !== emb.vectors.length) {
    throw new Error(`sample/embedding count mismatch: ${sample.length} vs ${emb.vectors.length}`)
  }
  console.log(`Sample corpus: ${sample.length} datasets, dim=${emb.dim}, model=${emb.embeddingModel}`)

  if (!KEY) {
    console.log('Skip Nebius (no NEBIUS_API_KEY / VITE_NEBIUS_API_KEY in .env)')
    console.log('smoke-app: all checks passed')
    return
  }

  const embRes = await fetch(`${BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ model: EMB, input: 'open data austria test' }),
  })
  if (!embRes.ok) throw new Error(`Embeddings ${embRes.status} ${await embRes.text()}`)

  const chatRes = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: CHAT,
      max_tokens: 48,
      messages: [{ role: 'user', content: 'Reply with exactly: {"ok":true}' }],
    }),
  })
  if (!chatRes.ok) throw new Error(`Chat ${chatRes.status} ${await chatRes.text()}`)

  console.log('Nebius embeddings + chat OK')
  console.log('smoke-app: all checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
