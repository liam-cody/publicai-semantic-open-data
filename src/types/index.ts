// Dataset shape used app-wide; live data is mapped from data.gv.at Hub-Search hits (legacy CKAN-compatible fields).
export interface CKANDataset {
  id: string
  name: string
  title: string
  notes: string
  author: string
  organization?: { title: string; name: string }
  tags: Array<{ name: string; display_name?: string }>
  metadata_modified?: string
  metadata_created?: string
  resources?: Array<{ format: string; url: string; name: string }>
}

export interface CKANSearchResponse {
  success: boolean
  result: {
    count: number
    results: CKANDataset[]
  }
  error?: { message: string; __type: string }
}

// Score + note from the LLM reranker
export interface LLMScore {
  index: number   // refers to position in the original CKAN result array
  score: number   // 0–10 relevance
  note: string    // one-sentence explanation
}

// A CKAN dataset enriched with reranking metadata
export interface RankedDataset extends CKANDataset {
  llmScore: number
  llmNote: string
  originalRank: number   // 0-based rank in CKAN results
  org: string            // resolved org name
}

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

// ── Agentic Search types ────────────────────────────────────────────────────

export interface SubQuery {
  query: string
  rationale: string
}

export interface QueryDecomposition {
  summary: string
  subqueries: SubQuery[]
}

export interface AgenticProposal extends CKANDataset {
  llmScore: number
  llmNote: string
  matchedSubqueries: string[]
}

export interface ColumnState {
  status: SearchStatus
  statusMsg: string
  results: CKANDataset[] | RankedDataset[]
  error?: string
}
