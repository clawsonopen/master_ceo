# Release Note (Short) - Phase 4
Date: 2026-04-09

## Summary
Phase 4 (Knowledge Base) is complete, including hardening.

## Delivered
- Knowledge Base backend stack (filesystem scaffold, indexing, semantic search, scoped access).
- SQLite memory integration with sqlite-vec support and deterministic fallback.
- KB tool/API surface (`search/read/write/list/wiki-entry/health/benchmark/policy-metrics`).
- Policy telemetry with retention + rollup + archive maintenance.
- Dashboard analytics cards for KB deny metrics.
- KB File Manager UI at `/knowledge-base`.

## Hardening
- Extended KB route integration coverage (deny/success paths).
- KB UI regression tests (search/save interactions).
- sqlite-vec benchmark report:
  - `paperclip/report/2026-04-09-kb-sqlite-vec-benchmark.md`
- Shared UI i18n baseline (`I18nProvider`, central messages, translation utils).

## Notes
- In small smoke datasets, sqlite-vec may not beat fallback latency; expected gains are in larger corpora and higher retrieval load.
