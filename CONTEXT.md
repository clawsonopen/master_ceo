# Project: Master CEO — AI Holding Management System

## What This Is
A desktop application (Electron) built on top of Paperclip 
(https://github.com/paperclipai/paperclip) that transforms it into a hierarchical 
AI company holding system with intelligent, cost-aware model routing and autonomous 
agent management.

## Core Vision
A user installs a single EXE (Windows) or DMG (macOS), goes through a guided setup, 
and gets a fully autonomous AI holding company that:
- Has a Master CEO that manages sub-companies
- Dynamically selects the best FREE model for each task across 7+ providers
- Falls back intelligently through paid models and local models
- Has agents that can hire other agents, assign skills, and manage projects
- Maintains a layered knowledge base with semantic search
- Researches the internet autonomously on behalf of the user
- Costs the developer (us) near $0 to operate at any scale

## Core Repositories (load via opensrc for context)
- `paperclipai/paperclip` — Base system (TypeScript, React, Node.js, PostgreSQL)
- `NousResearch/hermes-agent` — CEO agent framework (Python, tool-use, execution loops)
- `bradwmorris/ra-h_os` — Knowledge base with SQLite + sqlite-vec semantic search
- `karpathy/442a6bf555914893e9891c11519de94f` — LLM Wiki pattern (raw → wiki → schema)
- `karpathy/autoresearch` — Ratchet loop pattern (program.md → agent → improve/revert)
- `vercel-labs/opensrc` — Repo-to-context packaging tool

## Tech Stack
- **Application Shell:** Electron (single EXE/DMG, system tray, auto-updater)
- **Language:** TypeScript (entire stack — Electron main + renderer + Paperclip)
- **Frontend:** React (Paperclip's existing UI) + Tailwind CSS
- **Primary Database:** PostgreSQL (Paperclip's existing DB for companies, agents, tasks)
- **Knowledge Base Database:** SQLite + sqlite-vec (separate, for semantic search)
- **Local AI Runtime:** Ollama (managed as Electron subprocess)
- **Local AI Model:** Gemma 4 family (auto-recommended based on hardware detection)
- **Cloud AI:** BYOK (Bring Your Own Key) — Google Gemini, OpenRouter, Groq, Cerebras,
  Mistral, GitHub Models, NVIDIA NIM, OpenAI, Anthropic
- **Auth:** Firebase Auth (free tier, our backend — user never sees this)
- **Media Transfer:** P2P via Tailscale (dev) → Cloudflare Named Tunnel (prod)
- **Web Scraping:** Crawl4AI (free, local) + yt-dlp (YouTube transcripts)
- **Internationalization:** i18next (Turkish + English)

## Critical Technical Facts (Verified April 2026)
1. Paperclip is 96.9% TypeScript — there are NO Python files in the core
2. Google OAuth "free quota sharing" does NOT work for third-party apps — must use BYOK
3. Gemini 3.1 Pro has NO free tier — only Flash and Flash-Lite variants are free
4. OpenRouter has 28 free models at 200 RPD / 20 RPM each
5. Groq offers 1K-14.4K RPD on free tier (fastest inference at 300+ tok/s)
6. Cerebras offers ~1M tokens/day free
7. Cloudflare Quick Tunnels are dev-only (200 concurrent limit, no SSE) — use Named Tunnels
8. Gemma 4 supports native function calling — critical for agent tool use
9. All free providers combined give ~3000+ RPD/day before any paid model is needed
10. Electron apps are fully TypeScript — no Rust or other language needed
11. electron-updater works without code signing (SmartScreen warning is acceptable initially)

## Financial Model
- Developer cost at 50K users: $0-5/month (Firebase Auth free up to 50K MAU)
- User cost: $0 (free tier models + local Gemma 4) to whatever they choose (BYOK)
- Media transfer: P2P through tunnel, never stored in cloud = $0
- All AI inference: user's own API keys or free tier quotas or local Ollama
- Auto-updates: Hosted on GitHub Releases = $0

## Why Electron (Not Tauri)
- Entire stack stays TypeScript — no Rust learning curve
- AI coding tools (Opus, Codex, Qwen) have massive Electron training data
- electron-builder produces single EXE/DMG with one command
- Subprocess management (Ollama, cloudflared) is trivial with child_process
- Auto-updater is battle-tested (electron-updater + GitHub Releases)
- System tray, notifications, IPC — all native and well-documented
- VS Code, Discord, Slack, Notion, Obsidian all use Electron successfully
- Extra ~150MB bundle size is irrelevant when user downloads 9-18GB Gemma 4 model
---

## 2026-04-08 Context Update (Current As-Built)

- Master Company now includes 4 protected agents:
  - Master CEO
  - Cost & Provider Research Agent
  - Model Research Router Agent
  - AI News and Releases Agent
- Master-company staffing policy defaults to `canCreateAgents: true` for newly created/hired agents.
- Phase 3B provider-doc auto-discovery is implemented:
  - docs discovery + crawl + parser
  - auth/test/model endpoint extraction
  - confidence + evidence scoring
  - validation-gated publish into runtime metadata
- Provider Discovery Suggestions UI is live with discover/refresh/filter/publish actions.
- Instruction defaults were expanded and standardized:
  - managed bundle files include `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`, `SKILLS.md`
  - regular-company default `TOOLS.md` rationale improved
- Adapter neutrality hardening is in place:
  - no adapter is mandatory
  - implicit Claude default removed in create/onboarding/invite/import flows
  - adapter must be selected explicitly
- Org and approval behavior is clarified and fixed:
  - pending assignment block is policy-driven (`requireBoardApprovalForNewAgents`)
  - org chart preserves local roots under cross-company master reporting
- pending assignment errors now include direct approval guidance.

---

## 2026-04-09 KB Policy Analytics Ops

- KB policy analytics now runs with **hybrid retention**:
  - raw snapshots: `kb.policy_metrics.snapshot`
  - daily rollups: `kb.policy_metrics.rollup.daily`
  - monthly rollups: `kb.policy_metrics.rollup.monthly`
  - archive export events: `kb.policy_metrics.archive.export`

- Runtime behavior:
  - policy decisions are sampled dynamically (`env` + traffic-aware auto sampling)
  - critical events are always recorded:
    - all `deny` decisions
    - important scopes (`global`, `intelligence` by default)
    - first-seen key events (TTL-protected)

- Maintenance behavior:
  - old raw snapshots are rolled up + exported + deleted in batches
  - old rollups are pruned by retention
  - archive files are pruned by age and capped by total archive size

- Key environment knobs:
  - `PAPERCLIP_KB_POLICY_ALLOW_SAMPLE_RATE` (default `0.1`)
  - `PAPERCLIP_KB_POLICY_TRAFFIC_WINDOW_SECONDS` (default `60`)
  - `PAPERCLIP_KB_POLICY_MEDIUM_RPS_THRESHOLD` (default `5`)
  - `PAPERCLIP_KB_POLICY_HIGH_RPS_THRESHOLD` (default `20`)
  - `PAPERCLIP_KB_POLICY_AUTO_MEDIUM_SAMPLE_RATE` (default `0.25`)
  - `PAPERCLIP_KB_POLICY_AUTO_HIGH_SAMPLE_RATE` (default `0.1`)
  - `PAPERCLIP_KB_POLICY_IMPORTANT_SCOPES` (default `global,intelligence`)
  - `PAPERCLIP_KB_POLICY_FIRST_EVENT_TTL_SECONDS` (default `3600`)
  - `PAPERCLIP_KB_POLICY_SNAPSHOT_INTERVAL_MS` (default `60000`)
  - `PAPERCLIP_KB_POLICY_MAINTENANCE_INTERVAL_MS` (default `360000`)
  - `PAPERCLIP_KB_POLICY_SNAPSHOT_RETENTION_DAYS` (default `90`)
  - `PAPERCLIP_KB_POLICY_DAILY_ROLLUP_RETENTION_DAYS` (default `730`)
  - `PAPERCLIP_KB_POLICY_MONTHLY_ROLLUP_RETENTION_DAYS` (default `3650`)
  - `PAPERCLIP_KB_POLICY_RETENTION_BATCH_SIZE` (default `1000`)
  - `PAPERCLIP_KB_POLICY_ARCHIVE_EXPORT_ENABLED` (default `true`)
  - `PAPERCLIP_KB_POLICY_ARCHIVE_DIR` (default `${PAPERCLIP_INSTANCE_ROOT}/data/analytics/kb-policy-archive`)
  - `PAPERCLIP_KB_POLICY_ARCHIVE_RETENTION_DAYS` (default `3650`)
  - `PAPERCLIP_KB_POLICY_ARCHIVE_MAX_BYTES` (default `2147483648`)

- Dashboard support:
  - KB deny trend window selection: `24h | 7d | 30d`
  - deny trend supports action/scope query filters
  - deny-by-action and deny-by-scope cards are clickable and drive trend filtering

---

## 2026-04-09 Phase 4 Closure Update

- Phase 4 (Knowledge Base) is closed as feature-complete and hardening-complete.
- Implemented and validated:
  - KB scaffold/runtime/index/search/access control
  - watcher-based auto-indexing
  - policy telemetry metrics + dashboard policy cards
  - KB file manager UI (`/knowledge-base`)
  - sqlite-vec benchmark comparison report
- UI localization baseline is now centralized with a shared `I18nProvider` and translation utilities.
