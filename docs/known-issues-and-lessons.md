# Known issues and lessons learned

This document records **obstacles**, **failed first attempts**, and **why** the codebase looks the way it does. It is meant for maintainers and for anyone wondering "why wasn't X obvious?"

## 1. Node.js Hub-Search requests often return HTML, not JSON

**What we tried:** Call Hub-Search from Node (scripts), curl, or through the Vite proxy via a **server-side** `fetch` to `localhost`.

**What happened:** Response body was frequently the **Vue/HTML shell** of the portal, not JSON — likely **WAF**, routing, or **browser-only** API behavior that keys on browser User-Agent or Referer headers.

**What we did:**

- Added **Referer / Origin / browser User-Agent** on the Vite proxy (helps in some setups).
- Shipped a **dev-only UI button** that runs the **same** `searchCKAN` code path as Live mode in the **browser**, then downloads `sample-datasets.json` for you to commit after `embed-sample`.

**Lesson:** Prefer the **browser + dev proxy** path for exports; optional `npm run fetch-sample` if your network returns JSON to Node.

---

## 2. Documented Nebius embedding models returned 404

**What we tried:** Use common documentation examples such as `BAAI/bge-en-icl`, `BAAI/bge-m3`, etc., as the default embedding model.

**What happened:** Nebius responded with **`404` — model does not exist** for this account/region/catalog.

**Lesson:** Model slugs are **tenant- and catalog-specific**. Generic docs or blog posts may not match what your key can call.

**What we did:**

1. Called **`GET /v1/models`** with the real API key.
2. Picked an embedding model that actually appeared (e.g. **`Qwen/Qwen3-Embedding-8B`**).
3. Set that as the default in code and in `embed-sample.mjs`.

**Maintenance tip:** If embeddings fail after a provider update, re-list models and adjust defaults or `.env`.

---

## 3. Embedding dimension and file size

**What we tried:** Store embeddings next to source under `src/` and import them as JSON.

**What happened:** **Qwen3-Embedding-8B** produces **4096-dimensional** vectors. For 45 documents, the JSON became **several megabytes**, which **bloats** the Vite JS bundle if imported as a module.

**Lesson:** Large static vectors should be served as **static assets**, not bundled into `index.js`.

**What we did:** Write `public/sample-embeddings.json` and **`fetch('/sample-embeddings.json')`** at runtime with in-memory cache.

---

## 4. Vite environment variables (`VITE_` prefix)

**What we tried:** Put only `NEBIUS_API_KEY` in `.env` (no prefix).

**What happened:** The **browser** never saw the variable — Vite only exposes `import.meta.env.VITE_*`.

**Lesson:** Either duplicate the key as `VITE_NEBIUS_API_KEY` or type the key into the UI. Node scripts can keep using `NEBIUS_API_KEY`.

---

## 5. PowerShell vs bash command chaining

**What we tried:** `cd project && node script.mjs` in automation on Windows.

**What happened:** Older PowerShell versions reject `&&` as a statement separator.

**Lesson:** Use `;` on Windows PowerShell, or run commands from the project directory in one line without `&&`.

---

## 6. CORS on Hub-Search / Nebius

**What we tried:** Call Hub-Search and Nebius directly from the browser in dev.

**What happened:**
- **Hub-Search** sends `Access-Control-Allow-Origin: *`, so it works directly in production. No problem there.
- **Nebius** does **not** allow arbitrary browser origins on the public API URL, so direct browser calls are blocked by CORS in dev (and in production if you don't proxy).

**Lesson:** Use the **`/api/nebius` Vite proxy** in dev. In production, either run a small backend proxy for Nebius or check whether your Nebius base URL supports CORS for your specific origin and set `VITE_NEBIUS_BROWSER_PROXY=0` only then.

---

## 7. LLM output is not a guaranteed JSON API

**What we tried:** Instruct the model to return **only** JSON.

**What still happens:** Models occasionally wrap JSON in markdown fences or add prose.

**Lesson:** Defensive parsing (strip markdown code fences around JSON, trim whitespace) and a clear error message with a **snippet** of the raw output. For stricter behavior, use provider features like JSON schema / `response_format` **if** Nebius exposes them for your chosen chat model.

---

## 8. BM25 unit test ordering surprise

**What we tried:** Assert that the document with **more** query tokens always ranks first.

**What happened:** A **shorter** document with the same query term can score **higher** under Okapi BM25 (length normalization effects).

**Lesson:** Tests should assert **properties** (e.g. "irrelevant doc is last") not naive TF-only intuition.

---

## 9. Security: API keys in the frontend

**Issue:** Any value in `VITE_*` is **public** to visitors of a deployed site.

**Mitigation for real products:** Backend proxy, short-lived tokens, IP allowlists, per-user quotas—not implemented here by design.

---

## 10. "Hybrid" is RRF, not learned fusion

**Clarification:** We combine BM25 and dense lists with **Reciprocal Rank Fusion**, a **parameter-light** heuristic. We did **not** train a learned re-ranker or cross-encoder. That is an intentional scope limit for a small repo.

---

## Checklist when something breaks after an upgrade

| Symptom | Likely cause |
|---------|----------------|
| Embeddings 404 | Model renamed or removed from catalog |
| Chat 401 | Invalid or expired key |
| Sample lab "count mismatch" | Sample JSON edited without re-running `embed-sample` |
| Live search fails in dev | Dev server not running — Hub-Search proxy only exists in `npm run dev` |
| Live search fails in prod | Nebius CORS blocked — add a backend proxy or set `VITE_NEBIUS_BROWSER_PROXY=0` if origin is allowed |
| Huge bundle | Accidentally imported `sample-embeddings.json` from `src/` instead of `public/` |
| Export button missing | Only rendered in dev mode (`import.meta.env.DEV`) |
