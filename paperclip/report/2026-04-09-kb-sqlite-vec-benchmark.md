# KB sqlite-vec Benchmark Report (2026-04-09)

## Environment
- Host: Windows (PowerShell)
- Repo path: `C:\Users\ozany\Documents\MASTER CEO\paperclip`
- Script: `scripts/kb-perf-smoke.ts`
- Iterations: `20`
- Warmup: `5`
- Query profile: `memory indexing roadmap strategy`
- Dataset profile (from script): `31 markdown docs`

## Run A: JSON fallback (sqlite-vec unavailable)
- Setup:
  - `vec0.dll` temporarily moved out of `vendor/sqlite-extensions/`
  - `PAPERCLIP_KB_PERF_REQUIRE_VEC=false`
- Result:
  - `vector.available=false`
  - `backend=none`
  - `avgMs=3.5441`
  - `p95Ms=4.1746`
  - `minMs=3.1525`
  - `maxMs=4.5411`

## Run B: sqlite-vec required
- Setup:
  - `PAPERCLIP_SQLITE_VEC_EXTENSION_PATH=C:\Users\ozany\Documents\MASTER CEO\vendor\sqlite-extensions\vec0.dll`
  - `PAPERCLIP_KB_PERF_REQUIRE_VEC=true`
- Result:
  - `vector.available=true`
  - `backend=sqlite-vec`
  - `avgMs=3.9726`
  - `p95Ms=4.8271`
  - `minMs=3.1884`
  - `maxMs=6.5847`

## Delta (B vs A)
- `avgMs`: `+0.4285 ms` (`+12.1%`)
- `p95Ms`: `+0.6525 ms` (`+15.6%`)

## Interpretation
- In this small synthetic smoke dataset, sqlite-vec did not outperform JSON fallback.
- This is not unexpected for low-cardinality, short-query, low-k workloads where extension overhead can dominate.
- sqlite-vec should still be preferred for larger corpora and higher semantic search volume, where vector indexing scales better than JS cosine fallback.

## Notes
- Performance guard thresholds in script still passed in both modes (`avg <= 120ms`, `p95 <= 250ms`).
- The original `vec0.dll` location was restored after fallback measurement.
