/**
 * Regenerate public/sample-embeddings.json using Nebius OpenAI-compatible embeddings.
 * Usage: node scripts/embed-sample.mjs
 * Env: NEBIUS_API_KEY or VITE_NEBIUS_API_KEY (also read from `.env` in project root)
 * Optional: NEBIUS_BASE_URL (default https://api.tokenfactory.nebius.com/v1)
 * Optional: NEBIUS_EMBEDDING_MODEL (default Qwen/Qwen3-Embedding-8B)
 * Optional: NEBIUS_EMBEDDING_DIM (default 1024) — Matryoshka truncation dimension.
 *           Qwen3-Embedding supports 64/128/256/512/1024/2048/4096.
 *           1024 dims at 2,949 records ≈ 54 MB output (recommended).
 *           Full 4096 dims ≈ 200 MB (too large for browser fetch).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotenv } from './load-dotenv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadDotenv(path.join(__dirname, '..'))
const root = path.join(__dirname, '..')
const samplePath = path.join(root, 'src', 'data', 'sample-datasets.json')
const outPath = path.join(root, 'public', 'sample-embeddings.json')

const BASE =
  process.env.NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  process.env.VITE_NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  'https://api.tokenfactory.nebius.com/v1'
const KEY = process.env.NEBIUS_API_KEY || process.env.VITE_NEBIUS_API_KEY || ''
const MODEL =
  process.env.NEBIUS_EMBEDDING_MODEL ||
  process.env.VITE_NEBIUS_EMBEDDING_MODEL ||
  'Qwen/Qwen3-Embedding-8B'
const DIM = Number(process.env.NEBIUS_EMBEDDING_DIM) || 1024

function datasetToText(d) {
  const org = d.organization?.title || d.author || ''
  const tags = (d.tags || [])
    .map((t) => t.display_name || t.name)
    .filter(Boolean)
    .join(' ')
  return [d.title, d.name, d.notes, org, tags].filter(Boolean).join('\n').trim()
}

async function embedBatch(texts) {
  const body = { model: MODEL, input: texts, dimensions: DIM }
  const res = await fetch(`${BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embeddings HTTP ${res.status}: ${err.slice(0, 500)}`)
  }
  const data = await res.json()
  const rows = data.data
  if (!Array.isArray(rows)) throw new Error('Invalid embeddings response')
  rows.sort((a, b) => a.index - b.index)
  return rows.map((r) => r.embedding)
}

async function main() {
  if (!KEY) {
    console.error('Set NEBIUS_API_KEY or VITE_NEBIUS_API_KEY')
    process.exit(1)
  }
  const datasets = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
  const texts = datasets.map(datasetToText)
  const batchSize = 16
  const vectors = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize)
    console.error(`Embedding ${i}..${i + chunk.length - 1} / ${texts.length}`)
    const vecs = await embedBatch(chunk)
    vectors.push(...vecs)
  }
  const dim = vectors[0]?.length ?? 0
  if (dim !== DIM) {
    console.error(`Warning: requested dim ${DIM} but got ${dim} — API may not support dimensions param for this model`)
  }
  const payload = { embeddingModel: MODEL, dim, vectors }
  fs.writeFileSync(outPath, JSON.stringify(payload))
  const sizeMb = (Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(1)
  console.error(`Wrote ${outPath} (${vectors.length} vectors, dim ${dim}, model ${MODEL}, ~${sizeMb} MB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
