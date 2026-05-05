/**
 * Quick Nebius connectivity check (chat + embeddings).
 * Usage: node scripts/smoke-nebius.mjs
 * Env: NEBIUS_API_KEY or VITE_NEBIUS_API_KEY (also read from `.env`)
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotenv } from './load-dotenv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadDotenv(path.join(__dirname, '..'))

const BASE =
  process.env.NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  process.env.VITE_NEBIUS_BASE_URL?.replace(/\/$/, '') ||
  'https://api.tokenfactory.nebius.com/v1'
const KEY = process.env.NEBIUS_API_KEY || process.env.VITE_NEBIUS_API_KEY || ''
const CHAT =
  process.env.NEBIUS_CHAT_MODEL ||
  process.env.VITE_NEBIUS_CHAT_MODEL ||
  'meta-llama/Llama-3.3-70B-Instruct'
const EMB =
  process.env.NEBIUS_EMBEDDING_MODEL ||
  process.env.VITE_NEBIUS_EMBEDDING_MODEL ||
  'Qwen/Qwen3-Embedding-8B'

async function main() {
  if (!KEY) {
    console.error('Missing NEBIUS_API_KEY or VITE_NEBIUS_API_KEY')
    process.exit(1)
  }

  const embRes = await fetch(`${BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ model: EMB, input: 'open data austria' }),
  })
  if (!embRes.ok) {
    console.error('Embeddings failed', embRes.status, await embRes.text())
    process.exit(1)
  }
  const embJson = await embRes.json()
  const dim = embJson.data?.[0]?.embedding?.length
  console.log('Embeddings OK, dim=', dim)

  const chatRes = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: CHAT,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    }),
  })
  if (!chatRes.ok) {
    console.error('Chat failed', chatRes.status, await chatRes.text())
    process.exit(1)
  }
  const chatJson = await chatRes.json()
  const text = chatJson.choices?.[0]?.message?.content
  console.log('Chat OK:', JSON.stringify(text))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
