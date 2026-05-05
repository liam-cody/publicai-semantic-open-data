# Search Comparison — data.gv.at

Side-by-side comparison of **keyword / lexical search** vs **dense retrieval** vs **hybrid fusion** and **Nebius LLM reranking** for the Austrian open data portal.

## Modes

### Live (Hub-Search)

1. **Left** — data.gv.at **Hub-Search** (`/api/hub/search/search`, via Vite dev proxy in dev; direct HTTPS in production).
2. **Right** — the same hits re-scored with a Nebius chat model (0–10 relevance + short note).

### Sample catalog lab

A fixed list of datasets in [`src/data/sample-datasets.json`](src/data/sample-datasets.json) (bundled file is a **placeholder**; replace with **real Hub-Search metadata** — see below). **Search presets and BM25 tokenization are German-first** (`de-AT` casing, ä/ö/ü, ß→ss), matching typical portal metadata. All four columns use the same document pool:

| Column | Method |
|--------|--------|
| Lexical | Okapi BM25 in the browser |
| Dense | Nebius **query** embedding + cosine similarity vs committed vectors |
| Hybrid | Reciprocal rank fusion (RRF) of BM25 and dense rankings |
| LLM | Nebius chat reranks the **top 20** from hybrid |

A **bottom comparison strip** also appears automatically: it merges the hybrid pool with live Hub-Search results and sends the combined candidate list through the LLM reranker side-by-side with raw Hub-Search output.

Committed vectors: [`public/sample-embeddings.json`](public/sample-embeddings.json) (generated with `npm run embed-sample`). Default embedding model: **Qwen/Qwen3-Embedding-8B** (4096-dim). Use the same model in `.env` as in the index, or regenerate the file after changing models.

### Agentic Search

A three-step AI-assisted search flow (German-language prompts throughout):

1. **Decompose** — the LLM breaks a free-form data request into 3–5 focused sub-queries plus a plain-language summary.
2. **Retrieve** — all sub-queries run against Hub-Search in parallel; results are deduplicated.
3. **Synthesize** — the LLM scores every unique candidate (0–10) against the original description, with a 2–3 sentence rationale per dataset.

### Metadata Generator

Upload a **PDF document**; the app extracts text client-side with **pdfjs-dist** and sends it to the Nebius LLM to generate **DCAT-AP.at / OGD Austria Metadata v2.6** fields:

- **Auto-populated** (from PDF content): title (DE/EN), description (DE/EN), keywords, categorization (OGD Austria taxonomy), geographic toponym, begin/end datetime.
- **Flagged for manual input**: resource URL, maintainer, publisher, licence, etc.

Output can be copied as JSON.

### Replace sample with real metadata

**Option A — JSON-LD stream (e.g. `alle_metadaten_stream.jsonl` in project root):**

```bash
npm run jsonl-to-sample    # SAMPLE_LIMIT=60 by default; JSONL_PATH=... optional
npm run embed-sample
```

**Option B — Live official Hub-Search (`/api/hub/search/search` on data.gv.at, via Vite proxy):**

1. `npm run dev` and open the app.
2. Click **"DE: CKAN API → sample-datasets.json (~100)"** (dev only). This paginates Hub-Search and dedupes by dataset name (~100 rows by default).
3. Save the download over `src/data/sample-datasets.json` (or use the download path your browser picks).
4. Run `npm run embed-sample` (Nebius key).

**Option B2 — CLI** (dev server on port 3000, or use `npm run fetch-sample:auto`):

```bash
npm run fetch-sample
# Optional: SAMPLE_TARGET=120 npm run fetch-sample
```

**Option B3 — Collect via proxy only** (no Vite plugin needed; dev server must run):

```bash
CKAN_INTERNAL_PROXY=http://127.0.0.1:3000 npm run collect-ckan-sample
```

The export button calls **`/api/ckan-sample-bulk`**, which reuses your local **`/api/hub/search`** proxy. **Restart `npm run dev`** after pulling these changes.

Direct HTTP from Node to data.gv.at often returns HTML; the proxy path avoids that.

## Setup

```bash
npm install

# Copy and fill in your Nebius API key (Vite needs VITE_ prefix for the browser)
cp .env.example .env

npm run dev
# → http://localhost:3000
```

### Regenerate embeddings

After editing the sample JSON or changing the embedding model:

```bash
# Node 20+: load .env automatically, or export NEBIUS_API_KEY
node --env-file=.env scripts/embed-sample.mjs
# or
npm run embed-sample   # set NEBIUS_API_KEY in environment first
```

### Smoke test (API key)

```bash
node --env-file=.env scripts/smoke-nebius.mjs
# or
npm run smoke-nebius
```

### CORS (Live Hub-Search only)

Hub-Search sends `Access-Control-Allow-Origin: *`, so the live column works without a proxy in production static builds. Nebius does **not** send permissive CORS headers; in dev, Vite proxies `/api/nebius/*` → your `VITE_NEBIUS_BASE_URL`. For production, add a backend or serverless proxy for Nebius.

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_NEBIUS_API_KEY` | Nebius API key (browser). Can be pasted in the UI instead. |
| `VITE_NEBIUS_BASE_URL` | Optional. Default `https://api.tokenfactory.nebius.com/v1`. |
| `VITE_NEBIUS_CHAT_MODEL` | Optional. Default `meta-llama/Llama-3.3-70B-Instruct`. |
| `VITE_NEBIUS_EMBEDDING_MODEL` | Optional for **chat**; query embeddings use the model stored in `sample-embeddings.json`. |
| `VITE_NEBIUS_BROWSER_PROXY` | Optional. Default `1` (proxy on). Set to `0` to call Nebius directly from browser. |
| `VITE_HUB_SEARCH_BASE` | Optional. Default `https://www.data.gv.at/api/hub/search`. |

Scripts (`embed-sample`, `smoke-nebius`) also accept `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_EMBEDDING_MODEL`, `NEBIUS_CHAT_MODEL` without the `VITE_` prefix.

## Project structure

```
public/
  sample-embeddings.json   — committed index (regenerate with embed-sample)
scripts/
  embed-sample.mjs         — Nebius embeddings → public JSON
  smoke-nebius.mjs         — quick chat + embeddings check
  smoke-app.mjs            — Hub-Search + embedding count check
  fetch-sample-ckan.mjs    — optional CLI Hub-Search export
  ckan-sample-collect.mjs  — dev-server bulk collect
  jsonl-to-sample.mjs      — JSON-LD → sample-datasets.json
src/
  data/sample-datasets.json
  lib/
    nebius.ts              — OpenAI-compatible chat + embeddings helpers
    ckan.ts                — Hub-Search client (dev proxy / direct HTTPS)
    reranker.ts            — LLM JSON rerank via Nebius chat
    agenticSearch.ts       — query decomposition + proposal synthesis (agentic mode)
    datasetText.ts         — text blob for indexing
    lexical.ts             — BM25
    embeddings.ts          — cosine top-k + load public index
    rrf.ts                 — reciprocal rank fusion
    ckanSampleExport.ts    — dev browser export (Hub-Search → sample JSON download)
  components/
    ResultsColumn.tsx
    ResultCard.tsx
    AgenticSearchTab.tsx   — 3-step agentic search UI
    MetadataGeneratorTab.tsx — PDF upload + DCAT-AP.at metadata generation
  App.tsx
```

## Preset queries

The built-in preset pills cover **Wien-focused German queries** that match the Vienna open data catalog (e.g. "Bevölkerung nach Alter Wien", "Wahlergebnisse Wien"). Cross-lingual queries (English input against German metadata) also work and highlight where BM25 struggles while embeddings and the LLM remain effective.
