# Setup and configuration

## Prerequisites

- **Node.js** 18+ (20+ recommended for `node --env-file=.env`).
- **npm** (or compatible client).
- A **Nebius API key** with access to the models you configure (see below).

## Install and run

```bash
npm install
cp .env.example .env
# Edit .env — see Environment variables
npm run dev
```

Open the URL Vite prints (default **http://localhost:3000**).

## Environment variables

### Browser (Vite)

Only variables prefixed with `VITE_` are exposed to client code.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_NEBIUS_API_KEY` | For API calls without pasting in UI | — | Bearer token for Nebius |
| `VITE_NEBIUS_BASE_URL` | No | `https://api.tokenfactory.nebius.com/v1` | OpenAI-compatible base (no trailing slash required; code normalizes) |
| `VITE_NEBIUS_BROWSER_PROXY` | No | `1` (proxy on) | Set to `0` to call `VITE_NEBIUS_BASE_URL` directly from the browser (only if the target host sends CORS headers for your origin) |
| `VITE_NEBIUS_CHAT_MODEL` | No | `meta-llama/Llama-3.3-70B-Instruct` | Chat model for reranking |
| `VITE_NEBIUS_EMBEDDING_MODEL` | No* | `Qwen/Qwen3-Embedding-8B` | Used by `nebius.ts` default; **sample lab query vectors** use the model stored inside `sample-embeddings.json` |
| `VITE_HUB_SEARCH_BASE` | No | `https://www.data.gv.at/api/hub/search` | Override Hub-Search base URL |

\*If you regenerate embeddings with another model, the JSON file's `embeddingModel` field is authoritative for cosine search.

### Node scripts (`embed-sample`, `smoke-nebius`, etc.)

Scripts accept the same values **without** the `VITE_` prefix:

- `NEBIUS_API_KEY` (or `VITE_NEBIUS_API_KEY` if you export both)
- `NEBIUS_BASE_URL` / `VITE_NEBIUS_BASE_URL`
- `NEBIUS_EMBEDDING_MODEL` / `VITE_NEBIUS_EMBEDDING_MODEL`
- `NEBIUS_CHAT_MODEL` / `VITE_NEBIUS_CHAT_MODEL`

Additional script-only variables:

| Variable | Script | Purpose |
|----------|--------|---------|
| `SAMPLE_TARGET` | `ckan-sample-collect.mjs` | Number of datasets to collect |
| `OUT` | `ckan-sample-collect.mjs` | Output path override |
| `JSONL_PATH` | `jsonl-to-sample.mjs` | Path to input `.jsonl` file |
| `SAMPLE_LIMIT` | `jsonl-to-sample.mjs` | Max records to convert |
| `SKIP_NETWORK_TESTS` | `ckan.test.ts` | Set to any value to skip live Hub-Search test |

Example (Node 20+):

```bash
node --env-file=.env scripts/embed-sample.mjs
node --env-file=.env scripts/smoke-nebius.mjs
```

npm scripts:

```bash
npm run embed-sample
npm run smoke-nebius
npm run smoke-app
npm test
npm run build
```

## Regenerating embeddings

Whenever you change:

- `src/data/sample-datasets.json`, or
- the embedding model / provider base URL,

run:

```bash
node --env-file=.env scripts/embed-sample.mjs
```

This overwrites `public/sample-embeddings.json`. Commit the new file if you want others to run the sample lab without calling embeddings again.

## Dev proxies

`vite.config.ts` sets up two dev-only proxies:

| Dev path | Forwards to | Purpose |
|----------|-------------|---------|
| `/api/hub/search/*` | `https://www.data.gv.at/api/hub/search/*` | Live Hub-Search (CORS in browser) |
| `/api/nebius/*` | `{VITE_NEBIUS_BASE_URL}/*` | Nebius API (CORS in browser) |

A third route, `GET /api/ckan-sample-bulk`, is a dev-only middleware that collects sample datasets from Hub-Search and returns them as JSON (used by the UI export button).

**Production:** Browsers cannot rely on these dev proxies. For Nebius you need a **backend proxy** or set `VITE_NEBIUS_BROWSER_PROXY=0` only if Nebius sends CORS headers for your origin. Hub-Search sends `Access-Control-Allow-Origin: *` so the live search column works without a proxy in production static builds.

## Building for production

```bash
npm run build
npm run preview
```

Vite copies `public/sample-embeddings.json` into `dist/`. Ensure your static host serves it at **`/sample-embeddings.json`**.

## Troubleshooting quick checks

1. **401 / 403 from Nebius** — Key invalid or model not entitled; list models with `GET {base}/models` (authenticated).
2. **404 model** — Model slug wrong for your tenant; see [known-issues-and-lessons.md](known-issues-and-lessons.md).
3. **Sample lab: embedding count mismatch** — Rerun `embed-sample` after editing the sample JSON.
4. **Live search fails in dev** — Confirm dev server is running (Hub-Search proxy only applies to `npm run dev`).
5. **Sample lab export button not visible** — Export button only appears in dev mode (`import.meta.env.DEV`).
