/**
 * Collect dataset metadata from data.gv.at Hub-Search (GET …/api/hub/search/search).
 * Legacy CKAN package_search under /katalog/api/3/action/ returns 404 on www.data.gv.at.
 *
 * Prefer internalProxyBase (e.g. http://127.0.0.1:3000) so requests use the Vite dev proxy.
 *
 * CLI:
 *   CKAN_INTERNAL_PROXY=http://127.0.0.1:3000 node scripts/ckan-sample-collect.mjs
 * (dev server must be running)
 *
 * Or direct to the public API:
 *   node scripts/ckan-sample-collect.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const HUB_SEARCH = 'https://www.data.gv.at/api/hub/search/search'

const QUERIES = [
  'Bevölkerung',
  'Statistik Austria',
  'Luftqualität',
  'Umwelt',
  'Verkehr',
  'Wasser',
  'Wahl',
  'Gemeinde',
  'Wien',
  'Tourismus',
  'Landwirtschaft',
  'Energie',
  'Gesundheit',
  'Bildung',
  'Kriminalität',
  'Wohnung',
  'Karte',
  'Geodaten',
  'Denkmal',
  'Klima',
  'Budget',
  'Finanzen',
  'Arbeitsmarkt',
  'Steuern',
  'Justiz',
  'Soziales',
  'Kultur',
  'Sport',
  'Wetter',
  'Sicherheit',
  'Open Government Data',
]

function pickLocalized(obj, langs = ['de', 'en']) {
  if (!obj || typeof obj !== 'object') return ''
  for (const l of langs) {
    const v = obj[l]
    if (typeof v === 'string' && v.trim()) return v
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

function slimFromHub(hit) {
  const id = hit.id ?? hit.identifier?.[0] ?? ''
  const title = pickLocalized(hit.title) || id
  const notes = pickLocalized(hit.description)
  const author = hit.publisher?.name ?? ''
  const orgTitle = hit.catalog?.title ? pickLocalized(hit.catalog.title) : author
  const tags = (hit.keywords || []).map((k) => ({
    name: k.id,
    display_name: k.label ?? k.id,
  }))
  const resources = (hit.distributions || []).slice(0, 3).map((d) => ({
    format: d.format?.label ?? d.format?.id ?? '',
    url: d.access_url?.[0] ?? '',
    name: pickLocalized(d.title) || d.access_url?.[0] || '',
  }))
  return {
    id,
    name: id,
    title,
    notes,
    author,
    organization: orgTitle
      ? { title: orgTitle, name: orgTitle.toLowerCase().replace(/\s+/g, '-') }
      : undefined,
    tags,
    metadata_modified: hit.modified,
    resources,
  }
}

function rowKey(r) {
  const n = r?.name && String(r.name).trim()
  if (n) return n
  if (r?.id) return String(r.id)
  return ''
}

/**
 * @param {object} opts
 * @param {string} [opts.internalProxyBase] - e.g. http://127.0.0.1:3000 — use Vite /api/hub/search proxy
 */
export async function packageSearch(opts, q, rows, start = 0) {
  const limit = Math.min(1000, Math.max(1, rows))
  const page = Math.max(0, Math.floor(start / limit))
  const params = new URLSearchParams({
    filters: 'dataset',
    limit: String(limit),
    page: String(page),
  })
  const qt = typeof q === 'string' ? q.trim() : ''
  if (qt) params.set('q', qt)

  const internal = opts.internalProxyBase?.replace(/\/$/, '')
  const url = internal
    ? `${internal}/api/hub/search/search?${params}`
    : `${HUB_SEARCH}?${params}`

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!text.trim().startsWith('{')) {
    throw new Error(`Hub-Search non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`)
  }
  const json = JSON.parse(text)
  return json.result?.results ?? []
}

async function collectFromQuery(ctx, q, byName, target, pageSize, maxStart) {
  for (let start = 0; byName.size < target && start < maxStart; start += pageSize) {
    const batch = await packageSearch(ctx, q, pageSize, start)
    if (!batch.length) break
    for (const r of batch) {
      const slim = slimFromHub(r)
      const k = rowKey(slim)
      if (k && !byName.has(k)) {
        byName.set(k, slim)
      }
      if (byName.size >= target) return
    }
    if (batch.length < pageSize) break
  }
}

/**
 * @param {{ target?: number, pageSize?: number, maxStart?: number, internalProxyBase?: string }} opts
 */
export async function collectSampleDatasets(opts = {}) {
  const target = Math.min(500, Math.max(10, opts.target ?? 100))
  const pageSize = Math.min(100, Math.max(20, opts.pageSize ?? 50))
  const maxStart = opts.maxStart ?? 2000
  const ctx = { internalProxyBase: opts.internalProxyBase }
  const byName = new Map()

  try {
    await collectFromQuery(ctx, '*:*', byName, target, pageSize, maxStart)
  } catch {
    /* continue */
  }

  if (byName.size < target) {
    try {
      await collectFromQuery(ctx, '', byName, target, pageSize, maxStart)
    } catch {
      /* continue */
    }
  }

  for (const q of QUERIES) {
    if (byName.size >= target) break
    try {
      await collectFromQuery(ctx, q, byName, target, pageSize, maxStart)
    } catch {
      continue
    }
  }

  return [...byName.values()].slice(0, target)
}

async function cliMain() {
  const target = Number(process.env.SAMPLE_TARGET) || 100
  const out = path.resolve(root, process.env.OUT || 'src/data/sample-datasets.json')
  const internal = process.env.CKAN_INTERNAL_PROXY?.replace(/\/$/, '')

  console.error(
    internal
      ? `Using Vite proxy ${internal} (dev server must be running)`
      : 'Direct Hub-Search URL (set CKAN_INTERNAL_PROXY=http://127.0.0.1:3000 to use dev proxy)'
  )
  console.error(`Fetching up to ${target} datasets…`)

  const list = await collectSampleDatasets({ target, internalProxyBase: internal })
  if (list.length < 10) {
    console.error(`Too few results (${list.length}).`)
    if (!internal) {
      console.error('Tip: npm run dev  then  CKAN_INTERNAL_PROXY=http://127.0.0.1:3000 node scripts/ckan-sample-collect.mjs')
    }
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(list, null, 2))
  console.error(`Wrote ${list.length} → ${out}`)
  console.error('Next: npm run embed-sample')
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('ckan-sample-collect.mjs')
if (isMain) {
  cliMain().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
