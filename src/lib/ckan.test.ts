import process from 'node:process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { searchCKAN } from './ckan'

describe('searchCKAN (Hub-Search)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('maps hub JSON to CKANDataset[]', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          count: 1,
          results: [
            {
              id: 'abc-123',
              title: { de: 'Testtitel' },
              description: { de: 'Beschreibung' },
              publisher: { name: 'Amt' },
              keywords: [{ id: 'tag1', label: 'Eins' }],
              modified: '2025-01-01',
              distributions: [
                {
                  access_url: ['https://example.com/x.csv'],
                  format: { id: 'CSV', label: 'CSV' },
                  title: { de: 'Datei' },
                },
              ],
            },
          ],
        },
      }),
    })) as unknown as typeof fetch

    const rows = await searchCKAN('Wien', 5, 0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('abc-123')
    expect(rows[0].title).toBe('Testtitel')
    expect(rows[0].notes).toBe('Beschreibung')
    expect(rows[0].author).toBe('Amt')
    expect(rows[0].tags[0].name).toBe('tag1')
    expect(rows[0].resources?.[0]?.format).toBe('CSV')
  })

  it.skipIf(process.env.SKIP_NETWORK_TESTS === '1')(
    'returns live results from data.gv.at (integration)',
    async () => {
      const rows = await searchCKAN('Luftqualität', 5, 0)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].id).toBeTruthy()
      expect(typeof rows[0].title).toBe('string')
    }
  )
})
