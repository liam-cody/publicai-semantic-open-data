# APIs and data sources

## data.gv.at — Hub-Search (live mode)

The public portal no longer serves the legacy **CKAN Action API** at  
`https://www.data.gv.at/katalog/api/3/action/package_search` (that path returns **404**).  
Dataset discovery uses **Hub-Search** instead.

- **Endpoint (underlying):** `GET https://www.data.gv.at/api/hub/search/search`
- **OpenAPI / docs UI:** [https://www.data.gv.at/api/hub/search/](https://www.data.gv.at/api/hub/search/) (spec: `openapi.yaml` on the same service)
- **Dev URL in app:** `GET /api/hub/search/search?...` — Vite proxies to `https://www.data.gv.at/api/hub/search/search`. Production builds call the `https://…` URL directly (CORS `*` on this API).
- **Dev-only bulk export:** `GET /api/ckan-sample-bulk?n=100` — collects ~`n` unique datasets via Hub-Search (same semantics as the live column). Not available in `vite preview` / production builds.
- **Typical query parameters:** `q`, `filters=dataset`, `limit`, `page` (see OpenAPI).

**Response shape:** `{ result: { count, results: HubHit[] } }`. The app maps hits to `CKANDataset` in `src/lib/ckan.ts` (`hubHitToDataset`).

**Official references (external):**

- Portal: [https://www.data.gv.at](https://www.data.gv.at)
- **CKAN** `package_search` (for other portals still on CKAN): [CKAN API — Action API](https://docs.ckan.org/en/latest/api/)

---

## Nebius — OpenAI-compatible inference

**Base URL (default in code):** `https://api.tokenfactory.nebius.com/v1`  
(Some projects use `https://api.studio.nebius.ai/v1`; both worked for model listing in our tests—always confirm for your account.)

**Browser CORS:** Nebius does not allow arbitrary browser origins on the public API. In **`npm run dev`**, the app uses **`/api/nebius`** (Vite proxy → your `VITE_NEBIUS_BASE_URL` host) so chat and embeddings are same-origin. Set **`VITE_NEBIUS_BROWSER_PROXY=0`** only if you intentionally call the API URL from the browser and that host sends CORS for your origin. Production static builds still need a small backend proxy unless Nebius adds browser CORS.

### Chat completions (reranking)

- **HTTP:** `POST {base}/chat/completions`
- **Headers:** `Authorization: Bearer <key>`, `Content-Type: application/json`
- **Body (simplified):**
  - `model` — chat model id
  - `max_tokens` — upper bound on completion
  - `messages` — `[{ "role": "user", "content": "<prompt>" }]`

**Application use:** `src/lib/reranker.ts` expects the assistant message `content` to parse as JSON:  
`[{ "index": number, "score": number, "note": string }, ...]`

### Embeddings

- **HTTP:** `POST {base}/embeddings`
- **Body (simplified):**
  - `model` — embedding model id (**must match** `embeddingModel` in `public/sample-embeddings.json` for the sample lab)
  - `input` — string (query) or string[] (batch in `embed-sample.mjs`)

**Response:** OpenAI-style `data[].embedding` (float array).

**Documentation:** [Nebius inference / Token Factory docs](https://docs.nebius.com/studio/inference/api) (verify current paths and model lists).

### Model discovery

- **HTTP:** `GET {base}/models` with Bearer auth  
  Use this when defaults 404—model catalogs change.

---

## Local static data (sample lab)

| File | Format |
|------|--------|
| `src/data/sample-datasets.json` | `CKANDataset[]` — curated list |
| `public/sample-embeddings.json` | `{ embeddingModel, dim, vectors: number[][] }` |

**Invariant:** `vectors.length === sample-datasets.length` and row `i` matches `i`.

---

## Scripts touching external APIs

| Script | Calls |
|--------|--------|
| `scripts/embed-sample.mjs` | Nebius `embeddings` (batched) |
| `scripts/smoke-nebius.mjs` | Nebius `embeddings` + `chat/completions` |

No script in the repo **requires** CKAN access to succeed (sample lab is self-contained once embeddings exist).
