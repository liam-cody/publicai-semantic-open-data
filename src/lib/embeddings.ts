import type { NebiusClientConfig } from './nebius'
import { nebiusEmbedQuery } from './nebius'

export interface EmbeddingIndexFile {
  embeddingModel: string
  dim: number
  vectors: number[][]
}

let publicIndexCache: EmbeddingIndexFile | null = null

/** Loads /sample-embeddings.json (Vite public/) — cached in-memory. */
export async function loadPublicEmbeddingIndex(): Promise<EmbeddingIndexFile> {
  if (publicIndexCache) return publicIndexCache
  const res = await fetch('/sample-embeddings.json')
  if (!res.ok) {
    throw new Error(
      `Missing or unreadable public/sample-embeddings.json (HTTP ${res.status}). Run \`npm run embed-sample\` after setting NEBIUS_API_KEY, or restore the file from the repo.`
    )
  }
  publicIndexCache = (await res.json()) as EmbeddingIndexFile
  return publicIndexCache
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function topKByCosine(
  queryVec: number[],
  corpus: number[][],
  k: number
): { index: number; score: number }[] {
  const scored = corpus.map((vec, index) => ({
    index,
    score: cosineSimilarity(queryVec, vec),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

export async function embedQueryAndTopK(
  cfg: NebiusClientConfig,
  queryText: string,
  indexFile: EmbeddingIndexFile,
  k: number
): Promise<{ index: number; score: number }[]> {
  if (indexFile.vectors.length === 0) {
    throw new Error('Embedding index is empty')
  }
  const dim = indexFile.vectors[0].length
  if (indexFile.dim !== dim) {
    throw new Error(`Index dim ${indexFile.dim} does not match first vector length ${dim}`)
  }

  const qVec = await nebiusEmbedQuery(
    { ...cfg, embeddingModel: indexFile.embeddingModel },
    queryText,
    indexFile.dim
  )
  if (qVec.length !== dim) {
    throw new Error(`Query embedding dim ${qVec.length} != index dim ${dim}`)
  }
  return topKByCosine(qVec, indexFile.vectors, k)
}
