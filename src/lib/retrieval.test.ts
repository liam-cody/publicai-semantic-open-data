import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from './rrf'
import { buildBm25Corpus, buildBm25Index, rankBm25 } from './lexical'

describe('reciprocalRankFusion', () => {
  it('ranks ids appearing in both lists higher', () => {
    const a = [10, 20, 30]
    const b = [30, 10, 40]
    const out = reciprocalRankFusion([a, b], 60)
    expect(out[0].id).toBe(10)
    expect(out.map((x) => x.id)).toContain(30)
  })
})

describe('BM25', () => {
  it('ranks docs with query term above unrelated docs', () => {
    const texts = ['alpha beta gamma', 'foo bar baz', 'alpha delta']
    const docs = buildBm25Corpus(texts)
    const idx = buildBm25Index(docs)
    const ranked = rankBm25('alpha', docs, idx)
    const ids = ranked.map((r) => r.id)
    expect(ids[2]).toBe(1)
    expect(new Set(ids.slice(0, 2))).toEqual(new Set([0, 2]))
  })
})
