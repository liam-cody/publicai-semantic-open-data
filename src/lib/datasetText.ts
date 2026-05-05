import type { CKANDataset } from '../types'

/** Hub / legacy rows may store multilingual title as an object; stringify for indexing. */
export function fieldAsPlainText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    for (const k of ['de', 'en']) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return String(value).trim() === '[object Object]' ? '' : String(value)
}

/** Single text blob for lexical + embedding indexing. */
export function datasetToIndexText(d: CKANDataset): string {
  const org = d.organization?.title ?? d.author ?? ''
  const tags = (d.tags ?? [])
    .map((t) => t.display_name ?? t.name)
    .filter(Boolean)
    .join(' ')
  const title = fieldAsPlainText(d.title as unknown)
  const name = fieldAsPlainText(d.name as unknown)
  const notes = fieldAsPlainText(d.notes as unknown)
  const parts = [title, name, notes, org, tags].filter(Boolean)
  return parts.join('\n').trim()
}
