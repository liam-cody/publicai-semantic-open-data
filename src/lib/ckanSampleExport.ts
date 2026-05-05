import { searchCKAN } from './ckan'
import type { CKANDataset } from '../types'

/** German / neutral terms to diversify results when a catch-all query is not enough. */
export const CKAN_SAMPLE_QUERIES = [
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
] as const

function rowKey(r: CKANDataset): string {
  const n = r?.name && String(r.name).trim()
  if (n) return n
  if (r?.id) return String(r.id)
  return ''
}

function slimPackage(r: CKANDataset): CKANDataset {
  return {
    id: r.id,
    name: r.name || r.id,
    title: r.title,
    notes: typeof r.notes === 'string' ? r.notes : '',
    author: typeof r.author === 'string' ? r.author : '',
    organization: r.organization
      ? { title: r.organization.title, name: r.organization.name }
      : undefined,
    tags: (r.tags ?? []).map((t) => ({
      name: t.name,
      display_name: t.display_name,
    })),
    metadata_modified: r.metadata_modified,
    resources: (r.resources ?? []).slice(0, 3).map((x) => ({
      format: x.format,
      url: x.url,
      name: x.name,
    })),
  }
}

async function collectFromQuery(
  q: string,
  byName: Map<string, CKANDataset>,
  maxDatasets: number,
  pageSize: number,
  maxStart: number
): Promise<void> {
  for (let start = 0; byName.size < maxDatasets && start < maxStart; start += pageSize) {
    const batch = await searchCKAN(q, pageSize, start)
    if (!batch.length) break
    for (const r of batch) {
      const k = rowKey(r)
      if (k && !byName.has(k)) {
        byName.set(k, slimPackage(r))
      }
      if (byName.size >= maxDatasets) return
    }
    if (batch.length < pageSize) break
  }
}

/** Browser fallback: multiple Hub-Search calls (dev proxy or public HTTPS). */
async function buildSampleDatasetsFromCkanClient(options?: {
  maxDatasets?: number
  rowsPerQuery?: number
}): Promise<CKANDataset[]> {
  const maxDatasets = options?.maxDatasets ?? 100
  const pageSize = Math.min(100, Math.max(20, options?.rowsPerQuery ?? 50))
  const byName = new Map<string, CKANDataset>()
  const maxStart = 2000

  try {
    await collectFromQuery('*:*', byName, maxDatasets, pageSize, maxStart)
  } catch {
    /* ignore */
  }

  if (byName.size < maxDatasets) {
    try {
      await collectFromQuery('', byName, maxDatasets, pageSize, maxStart)
    } catch {
      /* ignore */
    }
  }

  for (const q of CKAN_SAMPLE_QUERIES) {
    if (byName.size >= maxDatasets) break
    try {
      await collectFromQuery(q, byName, maxDatasets, pageSize, maxStart)
    } catch {
      continue
    }
  }

  return [...byName.values()].slice(0, maxDatasets)
}

/**
 * Prefer dev-server bulk endpoint (Node → Hub-Search).
 * Falls back to client-side proxy calls if needed.
 */
export async function buildSampleDatasetsFromCkan(options?: {
  maxDatasets?: number
  rowsPerQuery?: number
}): Promise<CKANDataset[]> {
  const maxDatasets = options?.maxDatasets ?? 100

  if (import.meta.env.DEV) {
    try {
      const r = await fetch(`/api/ckan-sample-bulk?n=${maxDatasets}`)
      if (r.ok) {
        const data = (await r.json()) as CKANDataset[]
        if (Array.isArray(data) && data.length >= 10) {
          return data.slice(0, maxDatasets)
        }
      }
    } catch {
      /* fall through to client Hub-Search */
    }
  }

  const list = await buildSampleDatasetsFromCkanClient(options)
  if (list.length < Math.min(30, maxDatasets)) {
    throw new Error(
      `Zu wenige Datensätze (${list.length}). ` +
        `Dev: npm run dev neu starten. Alternativ: node scripts/ckan-sample-collect.mjs`
    )
  }
  return list
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
