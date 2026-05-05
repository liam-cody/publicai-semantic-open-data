# Assumptions and constraints

This section lists **explicit assumptions** so nobody mistakes the demo for full production search over the entire Austrian catalog.

## Product and data assumptions

1. **Representative sample:** Rows in `sample-datasets.json` illustrate **real** DCAT/Hub-Search-style metadata when built from exports or JSON-LD; the count is small (e.g. 60) and **not** a statistically representative sample of the full national catalog.
2. **Hub-Search as live baseline:** "Live" mode uses **Hub-Search** (`data.gv.at/api/hub/search`) only. The public portal may combine or prioritize other services; we assume Hub-Search is a **useful** but not necessarily **identical** baseline to what a user sees in every UI path on data.gv.at.
3. **Metadata correctness:** We assume publisher-provided metadata is the **ground truth** for titles and descriptions. The LLM **does not** verify factual claims in datasets; it scores **relevance to the query** only.
4. **Language mix:** We assume users may query in **English** while many records are **German**. The demo is built to **show** that mismatch; we do not assume any single model is optimal for all bilingual cases.

## Technical assumptions

1. **OpenAI-compatible API:** Nebius exposes `/v1/chat/completions` and `/v1/embeddings` compatible enough that plain `fetch` + JSON bodies work. If Nebius changes request/response shapes, `src/lib/nebius.ts` must be updated.
2. **Embedding alignment:** `vectors[i]` corresponds to `sample-datasets[i]`. Any reordering, insertion, or deletion in the JSON **without** re-embedding breaks the sample lab.
3. **Model availability:** Default model IDs in code match **one** Nebius project's catalog (`GET /v1/models`). Other accounts may need different slugs.
4. **Browser execution:** BM25 and cosine similarity run in the **browser**. Corpus size is tiny (dozens of docs in the demo); scaling to millions of rows would require a different architecture (server index, ANN library, etc.).
5. **LLM JSON output:** The reranker assumes the model returns parseable JSON. Malformed output surfaces as a user-visible error with a snippet of the raw response.

## Security and compliance assumptions

1. **Demo key exposure:** Using `VITE_NEBIUS_API_KEY` assumes you accept **client-side key exposure** for local or controlled demos—not production.
2. **No PII in prompts:** Only **public metadata** (title, description, tags, publisher) is sent to Nebius. Do not paste personal data into the query box in regulated environments without review.

## Scope boundaries (what we are **not** claiming)

- Full **offline enrichment** pipeline (LLM-generated descriptions for the whole catalog).
- **Hybrid search at national scale** with Elasticsearch + vector DB.
- **Official** endorsement by data.gv.at or any government body.
- **Guaranteed** improvement in every query; LLMs can **hallucinate** explanations or mis-score edge cases.

## Evaluation assumptions

- **No formal NDCG benchmark** is bundled; comparisons are **qualitative** (side-by-side in the UI).
- Unit tests cover **BM25 and RRF** mechanics only, not end-to-end retrieval quality against human labels.
