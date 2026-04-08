# Project Roadmap — Master CEO AI Holding

## Phase 0: Environment Setup (1-2 days)

- Install: Git, Node.js 22 LTS, pnpm, Python 3.11, WSL2, Windows Terminal
- Install: VS Code, AntiGravity IDE
- Install: cloudflared binary, sqlite-vec DLL
- Clone Paperclip → verify localhost:3100
- Clone hermes-agent and ra-h_os repos for reference
- Package repos with opensrc for context loading:
  - npx opensrc paperclipai/paperclip
  - npx opensrc NousResearch/hermes-agent
  - npx opensrc bradwmorris/ra-h_os
- Place CONTEXT.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, ROADMAP.md in project root

## Phase 1: Codebase Understanding (1-2 days)

- Study Paperclip: DB schema, API routes, provider system, UI, agent execution
- Create CODEBASE_MAP.md with all findings
- Identify all extension points
- Zero code changes in this phase

## Phase 2: Master Company Hierarchy (3-4 days)

- DB migration: company_type, is_deletable, parent_company_id
- DB migration: is_protected, hired_by, skills, kb_access, model_preference
- Unique constraint: only 1 master company
- API middleware: deletion protection for master company and protected agents
- Seed: Master Company + Master CEO + Cost Research Agent (auto on first run)
- UI: Crown icon, protected badges, hidden delete buttons
- 6 tests passing

## Phase 3: BYOK + Cost-Aware Model Router (5-7 days) — KILLER FEATURE

- api_keys table with AES-256 encryption
- API endpoints: save/list/test/delete keys for 9 providers
- Settings > API Keys UI page with test connection
- provider_registry table seeded with all known free models
- ProviderRegistry class: CRUD, filter by capability
- quota_tracker table with daily reset
- QuotaTracker class: usage recording, balance checking, quota reporting
- ModelRouter class: 7-tier selection, complexity analysis, fallback handling
- Natural language cost negotiation with user
- OllamaProvider: auto-detect, list models, OpenAI-compatible wrapper
- 5-minute background quota refresh
- Cost Dashboard UI: quota bars, tier indicator, selection log
- Manual model override option
- 10 tests passing
- Optional (future): after Phase 3B/3C, add company-level provider key overrides on top of global instance keys.

### Phase 3 Decision Architecture Notes

- Model Router is intentionally split into:
  - Router Agent (AI decision + reasoning output)
  - Router Enforcer (deterministic runtime safety checks)
- Why:
  - Avoid hardcoded model choice logic while still preventing unstable runtime behavior.
  - Keep recommendations adaptive to changing benchmarks/providers.
  - Guarantee safe execution when keys/quotas/policies change in real time.
- Master CEO workflow:
  - Combines Router Agent recommendations with Cost Research Agent updates.
  - Applies strategic constraints (budget/risk/quality preference).
  - Final execution still passes through Enforcer guardrails.
- Parameter evolution policy:
  - New routing parameters are proposal-driven and schema-validated.
  - No direct arbitrary runtime parameter injection to production routing.
  - Rollout path: proposal -> validation -> canary -> production.
- Safety baseline (non-negotiable):
  - Missing API key => block provider/model.
  - Exhausted quota/rate-limit => fallback or fail-fast with reason.
  - Policy/budget violation => deny execution with actionable feedback.

## Phase 4: Knowledge Base (4-5 days)

- /KnowledgeBase/ directory structure scaffolding
- KBFileManager: read, write, list, watch, scope extraction
- SQLite + sqlite-vec: memory.db with nodes, chunks, edges, vec_chunks
- KBIndexer: chunking, embedding (4-provider fallback), indexing
- KBSearcher: semantic search with scope filtering
- Paperclip tools: search_kb, read_kb, write_kb, list_kb
- Access control: scope-based validation per agent
- Auto-indexing file watcher with log.md updates
- 7 tests passing

## Phase 5: Hermes CEO + Cost Research Agent (4-5 days)

- CEO agent core: SOUL.md parser, tool execution loop (TypeScript)
- CEO tools: hire_agent, fire_agent, create_project, assign_task, select_model
- SkillManager: search, install, list, remove skills from marketplaces
- Cost Research Agent: daily scan routine, provider_registry updates
- Project scaffolding: /wiki/ + /raw/ + /code/ per project
- AutoResearch ratchet loop pattern in project log.md
- 9 tests passing

## Phase 6: Intelligence Department (3-4 days)

- Crawl4AI integration for web scraping
- yt-dlp integration for YouTube transcripts
- GitHub API for repo watching
- RSS feed parser
- sources.yaml configuration + management UI
- Nightly research routine (03:00): scan, filter, save, index
- Morning brief generation (08:00): compile, summarize, notify
- On-demand research capability for any CEO
- 6 tests passing

## Phase 7: Electron Desktop Packaging (3-4 days)

- Electron project setup with electron-builder
- Main process: Paperclip server + Ollama + cloudflared subprocess management
- IPC bridge: system info, Ollama control, tunnel control, app lifecycle
- Onboarding wizard: welcome, hardware scan, model install, API keys, complete
- System tray: Open Dashboard, Status, Check Updates, Quit
- Auto-updater: electron-updater + GitHub Releases
- Build: .exe (NSIS), .dmg, .AppImage
- 7 tests passing

## Phase 8: Mobile Access (2-3 days)

- Tailscale integration guide in Settings
- PWA: manifest.json, service worker, responsive CSS
- "Add to Home Screen" instructions
- Cloudflare Named Tunnel preparation (UI hooks)
- 4 tests passing

## Phase 9: Turkish Localization (2-3 days)

- i18next + react-i18next setup
- en.json: extract all UI strings
- tr.json: Turkish translations
- Language selector in Settings (hot-switch)
- Agent language preference (prompts in selected language)
- 4 tests passing

---

## Timeline Summary

| Phase | Duration | Primary IDE | Priority |
|-------|----------|------------|----------|
| 0: Setup | 1-2 days | Terminal | Required |
| 1: Codebase Map | 1-2 days | AntiGravity (Opus 4.6) | Required |
| 2: Master Hierarchy | 3-4 days | AntiGravity (Opus 4.6) | Required |
| 3: Model Router | 5-7 days | AntiGravity + Codex (UI) | CRITICAL |
| 4: Knowledge Base | 4-5 days | AntiGravity (Opus 4.6) | High |
| 5: Hermes CEO | 4-5 days | AntiGravity (Opus 4.6) | High |
| 6: Intelligence | 3-4 days | OpenCode (Qwen free) | Medium |
| 7: Electron | 3-4 days | AntiGravity + Codex | Medium |
| 8: Mobile | 2-3 days | Codex | Low |
| 9: Turkish i18n | 2-3 days | OpenCode (Qwen free) | Low |
| TOTAL | 29-40 days | | |

## IDE Assignment Strategy

| IDE | Model | Cost | Best For |
|-----|-------|------|----------|
| AntiGravity | Opus 4.6 | Free (AI Pro) | Complex architecture, DB schemas, model router, CEO logic |
| Codex | ChatGPT Plus | $0 (1 month free trial) | UI pages, Electron setup, PWA, visual components |
| OpenCode | Qwen 3.6 Plus | $0 (OpenRouter free) | Tests, documentation, i18n, intelligence scrapers |

## First AntiGravity Prompt

Read these 3 files in this project:
1. CONTEXT.md — what this project is
2. ARCHITECTURE.md — technical architecture
3. IMPLEMENTATION_PLAN.md — step-by-step plan

Then study the opensrc/paperclip/ directory.

Complete Phase 1: Create CODEBASE_MAP.md documenting:
- Database schema (all tables, columns, relationships)
- API routes (all endpoints with methods)
- Provider/model system (how models are currently selected)
- UI component structure (React component tree)
- Agent execution system (heartbeat, routines)
- File structure (directory layout)

Do NOT write any code. Analysis only.

---

## 2026-04-08 Status Addendum (Current As-Built)

### Phase 3 completed milestones
- Master hierarchy expanded to 4 protected agents (`Master CEO`, `Cost & Provider Research Agent`, `Model Research Router Agent`, `AI News and Releases Agent`).
- Master-company create/hire defaults now consistently grant `canCreateAgents: true`.
- Phase 3B provider discovery is implemented:
  - discovery crawl + parser + extraction + confidence scoring
  - suggestion list + publish validation gate
  - validated metadata publish into `api_keys` metadata
- Phase 3B UI is implemented for discovery suggestions and publish actions.

### Additional hardening completed
- Managed instruction bundles standardized to 5 files:
  - `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`, `SKILLS.md`
- Implicit adapter fallback removal:
  - explicit adapter selection is now required in create/onboarding/invite/import flows.
- Org + approval behavior finalized:
  - pending-assignment restriction is policy-based (`requireBoardApprovalForNewAgents`)
  - org chart root/layer rendering fixed for cross-company master-manager relationships
  - clearer pending-assignment error messages added.

### Remaining high-level roadmap
- Phase 4 completed on 2026-04-09 (including hardening follow-up).
- Remaining roadmap items are Phases 5-9.

---

## 2026-04-09 Status Addendum (Phase 4 Closed)

### Phase 4 delivered
- Knowledge Base core services and routes are live (scaffold, indexing, semantic search, scoped access).
- sqlite-vec integration is live with deterministic fallback behavior.
- Policy audit metrics are persisted with retention/rollup/archive maintenance.
- Dashboard policy analytics cards are live.
- KB file manager UI is live at `/knowledge-base`.

### Phase 4 hardening delivered
- Extended KB route integration tests (agent deny/success paths).
- KB UI regression tests.
- sqlite-vec benchmark report generated and documented.
- Shared global i18n provider + utilities introduced for consistent UI localization expansion.
