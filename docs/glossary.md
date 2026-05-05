# Glossary

Terms used in this project and in [overview.md](overview.md) / [architecture.md](architecture.md).

| Term | Meaning |
|------|---------|
| **BM25** | Okapi BM25 — a classic lexical ranking function using term frequency and inverse document frequency, with length normalization. |
| **CKAN** | Open-source data portal platform. data.gv.at previously exposed a CKAN Action API (`package_search`); the live search in this app uses **Hub-Search** instead (see below). The internal data shape (`CKANDataset`) still follows CKAN conventions. |
| **Cosine similarity** | Measure of alignment between two vectors (here, query embedding vs document embedding); higher means closer in semantic space. |
| **data.gv.at** | Austria's national open data portal. |
| **Dense retrieval** | Retrieval using **embeddings** (vectors) rather than keyword overlap alone. |
| **Embedding** | A fixed-size numeric vector representing text, produced by an embedding model. |
| **Hub-Search** | The search API used by data.gv.at (`GET /api/hub/search/search`). Returns datasets with `filters=dataset`, `q`, `limit`, `page` parameters. Replaces the legacy CKAN `package_search` endpoint for this portal. |
| **Hybrid search** | Combining more than one retrieval signal (here: BM25 + dense) before presenting results to the user or to an LLM. |
| **Lexical search** | Search based on **words/tokens** (and statistics like BM25), not neural embeddings. |
| **LLM** | Large language model; here used to **score and reorder** a small candidate list and explain relevance. |
| **Metadata** | Structured text about a dataset: title, description, tags, publisher, dates, etc. |
| **Nebius** | Cloud / AI inference provider; this app uses its OpenAI-compatible API for chat and embeddings. |
| **OpenAI-compatible API** | HTTP endpoints and JSON shapes similar to OpenAI's `/v1/chat/completions` and `/v1/embeddings`. |
| **RRF** | Reciprocal Rank Fusion — merges ranked lists by summing `1 / (k + rank)` per list; no need to normalize BM25 and cosine scores to the same scale. |
| **Reranking** | Taking an existing ordered list and **re-ordering** it (here with LLM scores). |
| **Sample catalog lab** | Mode that runs all retrieval methods on the **same fixed** local datasets (count set in `sample-datasets.json`, often ~60). |
| **Sparse metadata** | Records with little or no usable description/tags, making keyword search harder. |
| **Vite** | Frontend build tool and dev server; provides the Hub-Search and Nebius **proxies** in development. |
| **`VITE_` prefix** | Vite only injects environment variables starting with `VITE_` into browser code. |
