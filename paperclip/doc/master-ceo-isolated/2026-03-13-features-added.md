### Phase status update (2026-04-07)

1. Phase 2 completed for dev startup resilience: preflight auto-recovery is integrated into `pnpm dev` and `pnpm dev:once`.
2. Startup now auto-cleans stale embedded-postgres/process state before boot.
3. Startup now enforces single-instance + port conflict guard before boot.
4. Startup is now deterministic and health-gated (no ready state before `/api/health`).
5. Second start while active now exits fast with `already running` instead of entering loop/stuck behavior.
6. Manual fallback command is now available as `pnpm dev:recover`.
7. Remaining in this workstream: wake gating, token telemetry normalization, circuit-breaker policy hardening, and in-app productized repair UX.
