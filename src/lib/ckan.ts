import type { CKANDataset } from '../types'

/**
 * data.gv.at exposes dataset search via Hub-Search (OpenAPI: /api/hub/search/openapi.yaml),
 * not the legacy CKAN Action URL under /katalog/api/3/action/.
 */
const HUB_SEARCH_BASE =
  import.meta.env.VITE_HUB_SEARCH_BASE?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? '/api/hub/search' : 'https://www.data.gv.at/api/hub/search')

const HUB_SEARCH_PATH = '/search'

/** Hub-Search can be slow; avoid an infinite loading UI if the proxy or network stalls. */
const HUB_FETCH_MS = 90_000

function hubFetchSignal(): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(HUB_FETCH_MS)
  }
  const c = new AbortController()
  setTimeout(() => c.abort(), HUB_FETCH_MS)
  return c.signal
}

function pickLocalized(
  obj: Record<string, string> | undefined | null,
  langs: string[] = ['de', 'en']
): string {
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

interface HubDistribution {
  format?: { id?: string; label?: string }
  access_url?: string[]
  title?: Record<string, string>
}

interface HubSearchHit {
  id?: string
  identifier?: string[]
  title?: Record<string, string>
  description?: Record<string, string>
  keywords?: Array<{ id: string; label?: string }>
  modified?: string
  publisher?: { name?: string }
  catalog?: { title?: Record<string, string> }
  distributions?: HubDistribution[]
}

function hubHitToDataset(hit: HubSearchHit): CKANDataset {
  const id = hit.id ?? hit.identifier?.[0] ?? ''
  const title = pickLocalized(hit.title) || id
  const notes = pickLocalized(hit.description)
  const author = hit.publisher?.name ?? ''
  const orgTitle = hit.catalog?.title ? pickLocalized(hit.catalog.title) : author
  const tags = (hit.keywords ?? []).map((k) => ({
    name: k.id,
    display_name: k.label ?? k.id,
  }))
  const resources = (hit.distributions ?? []).slice(0, 10).map((d) => {
    const url = d.access_url?.[0] ?? ''
    const fmt = d.format?.label ?? d.format?.id ?? ''
    const name = pickLocalized(d.title) || url || fmt || 'resource'
    return { format: fmt, url, name }
  })

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

/**
 * Keyword search against data.gv.at Hub-Search (dataset index).
 * In dev, Vite proxies /api/hub/search → https://www.data.gv.at/api/hub/search
 *
 * @param start Offset: mapped to Hub-Search `page` as floor(start / rows)
 */
export async function searchCKAN(query: string, rows = 10, start = 0): Promise<CKANDataset[]> {
  const limit = Math.min(1000, Math.max(1, rows))
  const page = Math.max(0, Math.floor(start / limit))
  const q = query.trim()
  const params = new URLSearchParams({
    filters: 'dataset',
    limit: String(limit),
    page: String(page),
  })
  if (q) params.set('q', q)

  const url = `${HUB_SEARCH_BASE}${HUB_SEARCH_PATH}?${params}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: hubFetchSignal(),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    const isAbort = name === 'AbortError' || name === 'TimeoutError'
    const devHint =
      import.meta.env.DEV && HUB_SEARCH_BASE.startsWith('/')
        ? ' Ensure `npm run dev` is running (Vite proxies /api/hub/search → data.gv.at).'
        : import.meta.env.PROD
          ? ' If you opened index.html from disk, serve the build with `npm run preview` instead of file://.'
          : ''
    if (isAbort) {
      throw new Error(
        `Hub-Search timed out after ${HUB_FETCH_MS / 1000}s (${url.slice(0, 80)}…).${devHint}`
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Hub-Search network error: ${msg}.${devHint} URL: ${url.slice(0, 120)}`
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Hub-Search request failed: ${text}`)
  }

  const json = await res.json()
  const raw = json.result?.results ?? []
  return raw.map(hubHitToDataset)
}
