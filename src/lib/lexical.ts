/**
 * Okapi BM25 over a small in-memory corpus (sample lab).
 * Tokenization is German-first: de-AT casing, keep ä/ö/ü, ß → ss.
 */

const tokenize = (text: string): string[] => {
  const lower = text.toLocaleLowerCase('de-AT')
  const normalized = lower.replace(/ß/g, 'ss')
  const words = normalized.match(/[\p{L}\p{N}]+/gu)
  return words ?? []
}

export interface Bm25Document {
  id: number
  tokens: string[]
  len: number
}

export function buildBm25Corpus(texts: string[]): Bm25Document[] {
  return texts.map((t, id) => {
    const tokens = tokenize(t)
    return { id, tokens, len: tokens.length }
  })
}

/** BM25 index: term -> document frequency */
export function buildBm25Index(docs: Bm25Document[]): {
  docFreq: Map<string, number>
  avgLen: number
  nDocs: number
} {
  const docFreq = new Map<string, number>()
  let totalLen = 0
  for (const d of docs) {
    totalLen += d.len
    const seen = new Set<string>()
    for (const w of d.tokens) {
      if (!seen.has(w)) {
        seen.add(w)
        docFreq.set(w, (docFreq.get(w) ?? 0) + 1)
      }
    }
  }
  return { docFreq, avgLen: docs.length ? totalLen / docs.length : 0, nDocs: docs.length }
}

const K1 = 1.2
const B = 0.75

export function bm25Score(
  query: string,
  doc: Bm25Document,
  index: { docFreq: Map<string, number>; avgLen: number; nDocs: number }
): number {
  const qTokens = tokenize(query)
  if (qTokens.length === 0 || doc.len === 0) return 0

  const tf = new Map<string, number>()
  for (const w of doc.tokens) {
    tf.set(w, (tf.get(w) ?? 0) + 1)
  }

  let score = 0
  for (const w of qTokens) {
    const df = index.docFreq.get(w) ?? 0
    if (df === 0) continue
    const idf = Math.log(1 + (index.nDocs - df + 0.5) / (df + 0.5))
    const f = tf.get(w) ?? 0
    const denom = f + K1 * (1 - B + (B * doc.len) / index.avgLen)
    score += idf * ((f * (K1 + 1)) / denom)
  }
  return score
}

/** Returns document ids sorted by BM25 score descending. */
export function rankBm25(
  query: string,
  docs: Bm25Document[],
  index: { docFreq: Map<string, number>; avgLen: number; nDocs: number }
): { id: number; score: number }[] {
  const scored = docs.map((d) => ({ id: d.id, score: bm25Score(query, d, index) }))
  scored.sort((a, b) => b.score - a.score)
  return scored
}
