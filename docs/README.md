# Documentation index

This folder describes the **search-comparison** project: what it is for, how it works, what we assumed, and what went wrong before it worked.

| Document | Audience | Contents |
|----------|----------|----------|
| [Overview (non-technical)](overview.md) | Product, stakeholders, demos | Problem statement, what the app shows, modes, limitations in plain language |
| [Architecture (technical)](architecture.md) | Engineers | Components, data flow, Nebius APIs, sample lab pipeline |
| [Setup and configuration](setup-and-configuration.md) | Anyone running the app | Env vars, scripts, proxy, production notes |
| [APIs and data sources](api-and-data-sources.md) | Engineers | CKAN, Nebius, embedding index format |
| [Assumptions and constraints](assumptions-and-constraints.md) | Everyone | Explicit assumptions, scope boundaries |
| [Known issues and lessons learned](known-issues-and-lessons.md) | Engineers & maintainers | What failed on first try, workarounds, operational gotchas |

Start with [overview.md](overview.md) if you are not writing code; use [architecture.md](architecture.md) and [known-issues-and-lessons.md](known-issues-and-lessons.md) for implementation detail.

- [Glossary](glossary.md) — short definitions of BM25, RRF, embeddings, etc.
