# Overview (non-technical)

## What this project is

**Search comparison** is a small web application that demonstrates **why keyword-only search struggles** on a real-world open data portal (Austria's **data.gv.at**) and how **semantic retrieval plus an LLM** can improve relevance—at least for a curated slice of the problem.

It does **not** replace the official portal. It is a **research and demo** tool for side-by-side comparison.

## The problem we care about (business context)

Public data portals collect metadata from many publishers. Quality varies:

- Some datasets have **rich** titles, descriptions, and tags.
- Others have **almost no** description or inconsistent keywords.

Portal metadata is **predominantly German**. The app's **sample-lab presets** and **BM25 tokenization** are therefore **German-first** (`de-AT` casing, native ä/ö/ü, ß→ss). Cross-lingual queries (e.g. English) are still possible via embeddings and the LLM, but the default demo aligns with how people search **auf Deutsch** on data.gv.at.

## What the app shows (four modes)

### Live Hub-Search mode

- **Left:** Results from the portal's **Hub-Search** API (keyword-oriented), as you would get from a live search on data.gv.at.
- **Right:** The **same** results **re-ranked** by a large language model (via **Nebius**), with a short **relevance score** and **explanation** per row.

**Takeaway:** Even without building a full embedding index over the whole catalog, an LLM can **re-order** a fixed candidate list and **surface** why something is or is not a good match—especially useful when metadata is thin or the query is cross-lingual.

### Sample catalog lab mode

- A **fixed list of example datasets** loaded from `src/data/sample-datasets.json`. The repo may ship a **small placeholder**; you should **replace** it with **live Hub-Search exports** (dev-only button in the UI) so titles, notes, and tags are **real** portal metadata.
- Four columns:
  1. **Lexical (BM25)** — classic word-frequency ranking in the browser.
  2. **Dense** — **embeddings**: the query is embedded with Nebius; documents are compared using **precomputed** vectors and **cosine similarity**.
  3. **Hybrid** — **Reciprocal Rank Fusion (RRF)** merges BM25 and dense rankings without needing comparable numeric scores.
  4. **LLM** — Nebius chat **re-ranks the top 20** from the hybrid list.
- A **bottom comparison strip** runs automatically alongside the four columns: it combines the hybrid candidate pool with live Hub-Search results and sends the merged list through the LLM reranker, then shows the output side-by-side with raw Hub-Search.

**Takeaway:** This is a **miniature** version of the architecture people discuss for "better search": **retrieve** (lexical + dense + fuse) then **judge** (LLM). It runs on a **sample** so the repo stays small and every method ranks the **same** documents.

### Agentic Search mode

A three-step AI-assisted search that handles **complex, multi-faceted data requests**:

1. **Analyse** — the LLM reads the user's free-text description and generates a plain-language summary plus 3–5 focused sub-queries (in German).
2. **Retrieve** — each sub-query hits Hub-Search in parallel; results are merged and deduplicated, tracking which sub-query surfaced each dataset.
3. **Synthesize** — the LLM scores every unique candidate (0–10) against the original description, writing 2–3 sentences of German-language rationale per dataset.

**Takeaway:** Single short queries miss datasets that touch multiple topics. Agentic decomposition casts a wider net and lets the LLM connect the dots.

### Metadata Generator mode

Upload a **PDF document**; the app extracts text client-side (via **pdfjs-dist**, no server needed) and sends it to the Nebius LLM to fill in **DCAT-AP.at / OGD Austria Metadata v2.6** fields:

- **Auto-populated from the document:** title (DE/EN), description (DE/EN), keywords, categorization (using the OGD Austria category taxonomy), geographic toponym, and temporal coverage.
- **Flagged for manual input:** resource URL, maintainer, publisher, licence, and contact details—these require organisational knowledge the PDF does not contain.

The result can be copied as a JSON object ready for submission to data.gv.at.

**Takeaway:** Publishers who already have a PDF report no longer need to fill in metadata fields by hand; the LLM drafts most of the record for them.

## Important limitations (honest scope)

- **Not the full catalog:** Sample mode uses a **small fixed** list (e.g. 60 documents). Results do **not** generalize to the entire portal.
- **Live mode** only re-ranks what Hub-Search **already** returned. It does **not** pull in extra candidates from a vector database.
- **API keys** in the browser (Vite `VITE_*` variables) are convenient for demos but are **not** a production security pattern.
- **Official** portal search may use other backends in addition to Hub-Search; this app's "live" baseline is explicitly **Hub-Search** (`data.gv.at/api/hub/search`).

## Who should use this

- **Citizens / researchers / companies** exploring how **semantic** tools might help discover datasets (conceptual demo).
- **Technical teams** who need a **working reference** for Nebius chat + embeddings + a small hybrid retrieval loop.
- **Data publishers** who want to draft DCAT-AP.at metadata records from existing PDF documents.

## Success criteria for the demo

- A stakeholder can **run a preset German query** and **see** BM25 vs dense vs hybrid vs LLM **side by side** on the sample index.
- A developer can **reproduce** embeddings with `npm run embed-sample` and **verify** Nebius with `npm run smoke-nebius`.
- A publisher can **upload a PDF** and receive a partially-filled DCAT-AP.at metadata record in under 30 seconds.
