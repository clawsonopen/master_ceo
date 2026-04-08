# RA-H Memory Mapping (Phase 4)

This document tracks how `opensrc/repos/github.com/bradwmorris/ra-h_os` memory patterns map into Paperclip Phase 4.

## Source -> Target mapping

1. `ra-h_os/src/services/database/sqlite-runtime.ts`
- Source pattern: vector capability detection (`available` vs `none`) and explicit reason reporting.
- Target implementation:
  - `server/src/services/knowledge-base/indexer.ts`
    - `VectorCapability` type
    - extension load diagnostics (`extensionPath`, `reason`)
    - auto extension candidate discovery (`vendor/sqlite-extensions/vec0.*`)
    - `DatabaseSync(..., { allowExtension: true })` for runtime extension load
    - `getVectorCapability()` API
  - `server/src/routes/knowledge-base.ts`
    - `/api/knowledge-base/health` returns vector capability payload.

2. `ra-h_os/src/services/database/chunks.ts`
- Source pattern: semantic search with graceful fallback + rank fusion style retrieval.
- Target implementation:
  - `server/src/services/knowledge-base/searcher.ts`
    - semantic vector scoring (`cosineSimilarity`)
    - lexical ranking (`lexicalScore`)
    - reciprocal-rank-fusion style merge (`reciprocalRankFuse`)
    - unified `search()` and `searchWithContext()`.

3. `ra-h_os/src/services/database/edges.ts`
- Source pattern: graph edges enrich retrieval context.
- Target implementation:
  - `server/src/services/knowledge-base/indexer.ts`
    - markdown link extraction (`[...](...)`, `[[...]]`)
    - persisted `edges` relation (`links_to`) during indexing
    - related-node helpers for retrieval (`listRelatedNodeIds`, `getNodePrimaryChunk`)
  - `server/src/services/knowledge-base/searcher.ts`
    - `searchWithContext()` now appends related document context via link edges.

4. `ra-h_os/src/services/database/nodes.ts` + `searchRanking.ts`
- Source pattern: stronger lexical relevance scoring and query normalization.
- Target implementation:
  - `server/src/services/knowledge-base/searcher.ts`
    - normalized query/title/content matching
    - weighted occurrence scoring integrated into hybrid retrieval.

5. `ra-h_os` vector-health/operability philosophy (README + sqlite runtime services)
- Source pattern: app should run even when sqlite-vec is unavailable; report state, do not crash.
- Target implementation:
  - `server/src/services/knowledge-base/indexer.ts`
    - JSON vector fallback table when vec virtual table cannot be created.
  - `server/src/routes/knowledge-base.ts`
    - `/health` and `/benchmark` endpoints.

## Intentional differences from RA-H

1. Scope model
- RA-H is node/graph-centric.
- Paperclip KB is scope-centric (`global`, `intelligence`, `companies/...`) with `agents.kb_access`.

2. Chunk model
- RA-H chunk rows are node-linked and used in a graph-oriented schema.
- Paperclip chunk rows are document-linked (`nodes/chunks/edges` in `memory.db`) to align with Phase 4 plan.

3. Embedding fallback chain
- Paperclip Phase 4 enforces:
  - Gemini -> Ollama -> OpenRouter -> TF-IDF
- RA-H has a different embedding stack and orchestration flow.

4. Tool surface
- Paperclip exposes KB via:
  - `/api/knowledge-base/search`
  - `/api/knowledge-base/read`
  - `/api/knowledge-base/write`
  - `/api/knowledge-base/list`
  - `/api/knowledge-base/wiki-entry`
- This is integrated into Paperclip auth/actor model.
