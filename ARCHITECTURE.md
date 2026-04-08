

# System Architecture — Master CEO AI Holding

## System Overview Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1: Electron Desktop Shell                              │
│                                                               │
│  ┌─────────────────────────┐  ┌────────────────────────────┐ │
│  │  Main Process (Node.js) │  │  Renderer Process          │ │
│  │                         │  │  (Chromium + React)         │ │
│  │  • Paperclip Server     │  │                            │ │
│  │  • Ollama subprocess    │  │  • Paperclip Dashboard     │ │
│  │  • Cloudflared subprocess│  │  • Onboarding Wizard      │ │
│  │  • SQLite + sqlite-vec  │  │  • Settings / API Keys    │ │
│  │  • System tray          │  │  • Cost Dashboard         │ │
│  │  • Auto-updater         │  │  • Knowledge Base Browser │ │
│  │  • Hardware detection   │  │                            │ │
│  └──────────┬──────────────┘  └─────────────┬──────────────┘ │
│             │          IPC Bridge            │                │
│             └───────────────────────────────┘                │
│                                                               │
│  Bundled: ollama binary, cloudflared binary, sqlite-vec       │
│  Distribution: .exe (NSIS), .dmg, .AppImage                  │
│  Updates: electron-updater → GitHub Releases                  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  LAYER 2: Paperclip Core (Extended)                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Company Hierarchy Engine                                │ │
│  │  • Master Company (is_deletable: false, unique)          │ │
│  │  • Sub-Companies (created by Master CEO)                 │ │
│  │  • Parent-child company relationships                    │ │
│  │  • Heartbeat system for agent routines                   │ │
│  │  • Issue/Ticket task management                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  BYOK Key Manager                                        │ │
│  │  • Encrypted key storage (AES-256, never plaintext)      │ │
│  │  • 9 providers supported                                 │ │
│  │  • Per-provider connection testing                       │ │
│  │  • Settings UI for key management                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Cost-Aware Intelligent Model Router ⭐ KILLER FEATURE   │ │
│  │  • 7-tier model selection based on task complexity       │ │
│  │  • Real-time quota tracking across all providers         │ │
│  │  • Natural language cost negotiation with user           │ │
│  │  • 5-minute quota check intervals                        │ │
│  │  • Automatic fallback on 429 errors                      │ │
│  │  • Provider-aware: knows which free models exist today   │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  LAYER 3: Agent Brains                                        │
│                                                               │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │  CEO Agents           │  │  Worker Agents              │   │
│  │  (Hermes-Agent based) │  │  (Standard Paperclip)       │   │
│  │  • SOUL.md persona    │  │  • Installable skills       │   │
│  │  • Tool use           │  │  • KB read/write access     │   │
│  │  • Hire/fire agents   │  │  • Code execution           │   │
│  │  • Create projects    │  │  • Web scraping             │   │
│  │  • Assign tasks       │  │  • File management          │   │
│  │  • Select models      │  │                              │   │
│  └──────────────────────┘  └────────────────────────────┘   │
│                                                               │
│  Model assignment per agent:                                  │
│  • Each CEO picks models for their company's agents           │
│  • Master CEO can override any company's model choice         │
│  • ModelRouter handles actual selection within constraints│
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  LAYER 4: Knowledge Base (Hybrid)                             │
│                                                               │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │  File System Layer    │  │  SQLite + sqlite-vec Layer │   │
│  │  (Karpathy LLM Wiki) │  │  (Semantic Search Index)    │   │
│  │  • /raw/ directories  │  │  • nodes table             │   │
│  │  • /wiki/ directories │  │  • chunks table (vectors)  │   │
│  │  • /policies/         │  │  • edges table (relations) │   │
│  │  • /projects/         │  │  • Scope-based filtering   │   │
│  └──────────────────────┘  └────────────────────────────┘   │
│                                                               │
│  Embedding provider priority:                                 │
│  1. Gemini text-embedding API (if key available)              │
│  2. Local Gemma 4 via Ollama (free, always available)         │
│  3. OpenRouter free embedding model                           │
│  4. Simple TF-IDF fallback (no external dependency)           │
└──────────────────────────────────────────────────────────────┘
```

## Electron IPC Bridge

```typescript
// Main Process → Renderer Process communication

// System Information
ipcMain.handle('system:getInfo', async () => {
  const si = require('systeminformation');
  return {
    cpu: await si.cpu(),
    mem: await si.mem(),
    gpu: await si.graphics(),
    disk: await si.fsSize(),
    os: await si.osInfo()
  };
});

// Ollama Management
ipcMain.handle('ollama:status', async () => { /* running/stopped, models list */ });
ipcMain.handle('ollama:install', async () => { /* install ollama binary */ });
ipcMain.handle('ollama:pullModel', async (e, modelName) => { /* stream progress */ });
ipcMain.handle('ollama:listModels', async () => { /* installed models */ });
ipcMain.handle('ollama:start', async () => { /* start ollama serve */ });
ipcMain.handle('ollama:stop', async () => { /* stop ollama process */ });

// Cloudflared Management
ipcMain.handle('tunnel:start', async () => { /* start named tunnel */ });
ipcMain.handle('tunnel:stop', async () => { /* stop tunnel */ });
ipcMain.handle('tunnel:getUrl', async () => { /* return tunnel URL */ });

// App Lifecycle
ipcMain.handle('app:checkUpdate', async () => { /* check GitHub Releases */ });
ipcMain.handle('app:installUpdate', async () => { /* download and queue */ });
ipcMain.handle('app:getVersion', async () => { /* current version */ });
```

## Company Hierarchy

```
Master Holding Company (is_deletable: false)
│
├── Master CEO (is_protected: true)
│   ├── Role: Orchestrates all sub-companies
│   ├── Can: Create/delete companies, override any agent's model
│   ├── Can: Access ALL knowledge base scopes
│   └── Brain: Dynamic model selection (highest tier available)
│
├── Cost & Provider Research Agent (is_protected: true)
│   ├── Role: Scans all AI providers daily for new free models,
│   │         quota changes, pricing updates
│   ├── Routine: Daily at 04:00
│   ├── Scans: OpenRouter API, Google AI, Groq, Cerebras,
│   │          Mistral, GitHub Models, NVIDIA NIM
│   ├── Output: /Global_Holding/model_research/*.md
│   │           + provider_registry DB updates
│   │           + quota_tracker DB updates
│   └── Notifies: Master CEO when new free models found
│                  or quotas change
│
├── Intelligence & Acquisition Agent (is_protected: false)
│   ├── Role: Researches internet based on user's interest profile
│   ├── Tools: Crawl4AI, yt-dlp, RSS feeds
│   ├── Routine: Daily at 03:00
│   ├── Output: /Intelligence/raw/*.md → auto-indexed to SQLite-Vec
│   └── Morning brief generated at 08:00
│
├── Sub-Company A (created by Master CEO for specific domain)
│   ├── Company A CEO (Hermes-Agent based)
│   │   ├── Can: Hire/fire agents WITHIN own company only
│   │   ├── Can: Create projects within own company
│   │   ├── Can: Select models for own agents (within budget)
│   │   ├── Cannot: Modify Master Company or its agents
│   │   └── KB Access: own company + global (read)
│   │
│   ├── Agent 1 (hired by Company A CEO)
│   │   ├── Skills: [code_write, code_review, git_commit]
│   │   └── KB Access: company_a + company_a/project_x
│   │
│   └── Agent 2 (hired by Company A CEO for specific task)
│       ├── Skills: [web_search, summarize]
│       └── KB Access: company_a + intelligence (read only)
│
└── Sub-Company B (another domain)
    ├── Company B CEO
    └── Agents...
```

## Database Schema Extensions (PostgreSQL — on top of Paperclip's existing schema)

### Companies Table Extensions

```sql
ALTER TABLE companies ADD COLUMN company_type TEXT DEFAULT 'regular'
  CHECK (company_type IN ('master', 'regular'));
ALTER TABLE companies ADD COLUMN is_deletable BOOLEAN DEFAULT true;
ALTER TABLE companies ADD COLUMN parent_company_id UUID REFERENCES companies(id);

CREATE UNIQUE INDEX idx_one_master_company
  ON companies (company_type) WHERE company_type = 'master';
```

### Agents Table Extensions

```sql
ALTER TABLE agents ADD COLUMN is_protected BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN hired_by UUID REFERENCES agents(id);
ALTER TABLE agents ADD COLUMN skills JSONB DEFAULT '[]';
ALTER TABLE agents ADD COLUMN kb_access JSONB DEFAULT '{"read":[],"write":[],"search":[]}';
ALTER TABLE agents ADD COLUMN model_preference JSONB DEFAULT '{"mode":"auto"}';
```

### New Tables

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT false,
  last_tested_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE provider_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_free BOOLEAN DEFAULT false,
  rpm_limit INTEGER,
  rpd_limit INTEGER,
  context_window INTEGER,
  supports_tools BOOLEAN DEFAULT false,
  supports_vision BOOLEAN DEFAULT false,
  input_price_per_1m REAL,
  output_price_per_1m REAL,
  quality_tier INTEGER DEFAULT 5,
  last_scanned_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(provider, model_id)
);

CREATE TABLE quota_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  daily_limit INTEGER,
  used_today INTEGER DEFAULT 0,
  balance_usd REAL,
  last_429_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  reset_at TIMESTAMP,
  UNIQUE(provider, model_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','archived')),
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMP DEFAULT NOW(),
  kb_path TEXT NOT NULL
);
```

## Knowledge Base File Structure

```
/KnowledgeBase/
├── /Global_Holding/
│   ├── /raw/                          # Unprocessed data
│   ├── /wiki/                         # LLM-curated summaries
│   │   ├── index.md                   # Master directory of all knowledge
│   │   └── log.md                     # Chronological change log
│   ├── /policies/                     # Rules all companies must follow
│   │   ├── cost_policy.md             # Budget rules, model selection guidelines
│   │   └── security_policy.md         # Data access rules
│   └── /model_research/               # Cost Research Agent's output
│       ├── free_models_daily.md       # Updated list of all free models
│       ├── provider_status.md         # Which providers are up/down
│       ├── quota_changes.md           # Detected quota/pricing changes
│       └── recommendations.md         # Model switching suggestions
│
├── /Intelligence/
│   ├── /raw/                          # Nightly internet crawls
│   │   ├── 2026-04-06_yt_karpathy_new_video.md
│   │   ├── 2026-04-06_x_anthropic_announcement.md
│   │   └── 2026-04-06_gh_trending_ai_repos.md
│   ├── /wiki/
│   │   ├── index.md
│   │   ├── log.md
│   │   └── daily_brief_2026-04-06.md
│   └── /sources.yaml                  # User's tracked sources
│
└── /Companies/
    └── /{company_name}/
        ├── /raw/                      # Company-level raw data
        ├── /wiki/                     # COMPANY MAIN WIKI
        │   ├── index.md               # Company overview, mission
        │   ├── log.md                 # Company change log
        │   └── team.md               # Current agents and their roles
        │
        └── /projects/
            └── /{project_name}/
                ├── /raw/              # Project-specific research
                ├── /wiki/             # PROJECT MINI-WIKI
                │   ├── index.md       # Project overview and goals
                │   ├── log.md         # Change log (autoresearch pattern)
                │   ├── architecture.md
                │   └── todo.md
                └── /code/             # Project source code
```

## Knowledge Base SQLite-Vec Schema (separate database: /KnowledgeBase/memory.db)

```sql
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL,
  title TEXT,
  content_hash TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  scope TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE vec_chunks USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[768]
);
```

### Access Control

```sql
-- Master CEO: all scopes (no WHERE filter)
-- Company CEO: own company + global + intelligence
-- Company Agent: only scopes in their kb_access.search array

-- Example: Company A Developer searches assigned project + company
SELECT c.content, c.scope, vec_distance_cosine(v.embedding, ?) as dist
FROM chunks c JOIN vec_chunks v ON c.id = v.chunk_id
WHERE c.scope IN ('company_a', 'company_a/project_x', 'global')
ORDER BY dist ASC LIMIT 10;
```

## Dynamic Intelligent Model Selection — 7-Tier System

### Free Provider Registry (Verified April 2026)

| Provider | Notable Free Models | RPM | RPD | Context | Tools | Speed |
|----------|-------------------|-----|-----|---------|-------|-------|
| Groq | Llama 3.3 70B, Llama 4 Scout, Qwen3 32B | 30-60 | 1K-14.4K | 66K-131K | Yes | 300+ tok/s |
| Cerebras | Llama 3.3 70B, Qwen3 32B/235B, GPT-OSS 120B | 30 | ~1M tok/day | 64K-256K | Yes | Fast |
| OpenRouter | 28 free models: Qwen 3.6 Plus, Nemotron 3 Super 120B, Qwen3 Coder 480B, MiniMax M2.5, Hermes 3 405B, etc. | 20 | 200 each | 8K-1M | Yes | Medium |
| Google AI Studio | Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 3 Flash Preview, 3.1 Flash-Lite Preview | 5-15 | 100-1000 | 1M | Yes | Medium |
| Mistral | Mistral Large, Small, Codestral | 2 | 1B tok/mo | 128K | Yes | Medium |
| GitHub Models | GPT-4o, GPT-4.1, o3, Grok-3 | 10-15 | 50-150 | 8K-128K | Yes | Medium |
| NVIDIA NIM | DeepSeek R1, Llama, Kimi K2.5 | 40 | 1K credits | 128K | Yes | Fast |
| Local (Ollama) | Gemma 4 e2b/e4b/26b/31b | Unlimited | Unlimited | 128K-256K | Yes | Hardware-dependent |

Combined free capacity: approximately 3000+ RPD/day across all providers.

### 7-Tier Decision Flow

```
Task arrives → Analyze complexity (1-10)

TIER 0: Trivial (1-2) — "What time is it?", "Copy this file"
  → Local Gemma 4 — $0, unlimited, instant, no network needed

TIER 1: Simple (3) — "Check my calendar", "Read this email"
  → Groq Llama 3.3 70B — $0, 1K RPD, 300+ tok/s
  → Cerebras Qwen3 32B — $0, ~1M tok/day
  → Fallback: Gemini 2.5 Flash-Lite — $0, 1000 RPD

TIER 2: Medium (4-5) — "Summarize this report", "Quick code review"
  → OpenRouter Qwen 3.6 Plus — $0, 200 RPD, 1M context
  → OpenRouter Nemotron 3 Super 120B — $0, 200 RPD
  → Gemini 2.5 Flash — $0, 250 RPD
  → Fallback: Cerebras Llama 70B — $0, ~1M tok/day

TIER 3: High (6-7) — "Analyze codebase", "Write detailed report"
  → Gemini 2.5 Pro (free) — $0, 100 RPD
  → OpenRouter Qwen3 Coder 480B — $0, 200 RPD (great for code)
  → Mistral Large (free) — $0, 2 RPM (slow but powerful)
  → Fallback: Local Gemma 4 26B — $0, unlimited

TIER 4: Very High (8) — "Design app architecture", "Deep analysis"
  → GitHub Models GPT-4.1 — $0, 50-150 RPD
  → OpenRouter Hermes 3 405B — $0, 200 RPD
  → NVIDIA NIM DeepSeek R1 — $0, 1K credits
  → Fallback: Gemini 2.5 Pro (free if quota remains)

TIER 5: Maximum (9-10) — Paid models, with user negotiation
  → Check OpenRouter balance:
    - balance >= $5.00 → Opus 4.6 ($3/$15 per 1M tok)
    - balance >= $1.00 → Sonnet 4.6 ($1/$5 per 1M tok)
    - balance >= $0.25 → Qwen 3.6 Plus paid (1000 RPD)
  → Check Gemini paid key → Gemini 2.5 Pro paid
  → Else → Natural language negotiation with user

TIER 6: All free quotas exhausted, no paid balance
  → Local Gemma 4 (best installed variant)
  → Natural language notification to user about quota reset times
```

### Real-Time Cost Monitoring

```
CostIntelligenceAgent runs every 5 minutes:
1. Query quota_tracker for all providers
2. Call OpenRouter /api/v1/auth/key for real-time balance
3. Check if any provider returned 429 recently
4. Update internal model priority rankings
5. If paid balance < $0.25 → auto-downgrade to next free tier
6. If new free quota available (daily reset) → auto-upgrade tier
```

### Natural Language Cost Report Example

```
Master CEO:

"Efendim, kapsamlı bir uygulama mimarisi tasarlamam gerekiyor.

FREE Kotalar:
• Groq Llama 70B: 847/1000 RPD kaldı
• OpenRouter Qwen 3.6+: 156/200 RPD kaldı
• Gemini 2.5 Pro: 23/100 RPD kaldı
• Gemini 2.5 Flash: 198/250 RPD kaldı
• Cerebras: ~700K/1M token kaldı
• Lokal Gemma 4 26B: sınırsız

Ücretli:
• OpenRouter: $4.27 bakiye

Önerim:
Bu görev karmaşıklık 9. Opus 4.6 ile planlayalım ($~0.85).
Her 5 dakikada bir bakiye kontrol ederim.
$0.25 kalınca Gemini 2.5 Pro free'ye geçerim.

Ne dersiniz?"
```

## Gemma 4 Local Model Variants

| Model | Download Size | Min RAM | GPU Recommended | Ollama Command |
|-------|-------------|---------|-----------------|----------------|
| gemma4:e2b | 7.2 GB | 8 GB | Optional | ollama pull gemma4:e2b |
| gemma4:e4b | 9.6 GB | 16 GB | Optional | ollama pull gemma4 |
| gemma4:26b (MoE, 4B active) | 18 GB | 24 GB RAM or 12 GB VRAM | Recommended | ollama pull gemma4:26b |
| gemma4:31b (Dense) | 20 GB | 32 GB+ | Strongly recommended | ollama pull gemma4:31b |

Hardware detection auto-recommends:
- 32 GB RAM + 12 GB+ VRAM → gemma4:26b
- 16 GB RAM → gemma4:e4b
- 8 GB RAM → gemma4:e2b
- Less than 8 GB RAM → skip local, cloud only

## Guided Onboarding Flow (Electron)

```
Step 1: Welcome + Language Selection
  → "Hoş geldiniz / Welcome"
  → [Türkçe] [English]

Step 2: Hardware Detection (automatic via systeminformation)
  → Display: CPU, RAM, GPU/VRAM, Free Disk
  → Recommend: Best Gemma 4 variant
  → Options: [Install recommended] [Choose different] [Skip — cloud only]

Step 3: Model Download (if selected)
  → Ollama auto-installed if missing
  → Progress bar for model download
  → Completion confirmation

Step 4: API Keys (all optional)
  → Google Gemini: input + link to ai.google.dev
  → OpenRouter: input + link to openrouter.ai
  → Groq: input + link to console.groq.com
  → Cerebras: input + link to cloud.cerebras.ai
  → [Skip all] → local + any no-key free models

Step 5: Complete
  → Master Company auto-created
  → Master CEO auto-assigned (is_protected: true)
  → Cost Research Agent auto-assigned (is_protected: true)
  → First task: "Scan all providers and generate initial cost report"
  → Redirect to Paperclip Dashboard
```

## Networking Architecture

### Development Phase
- Paperclip runs on localhost:3100 inside Electron
- Mobile access via Tailscale (free, up to 3 devices)
- No cloud infrastructure needed

### Production Phase
- Cloudflare Named Tunnel (free with Cloudflare account)
- NOT Quick Tunnel (200 concurrent limit, no SSE)
- Firebase Auth for user identity (free up to 50K MAU)
- Firestore for tunnel address registry (free up to 50K reads/day)
- Media: P2P through tunnel, never stored in cloud

### Cost at Scale

| Service | Free Tier | At 50K Users | Our Cost |
|---------|-----------|-------------|----------|
| Firebase Auth | 50K MAU | 50K MAU | $0 |
| Firestore | 50K reads/day | ~50K reads/day | $0-5/mo |
| Cloudflare Tunnel | Unlimited | Unlimited | $0 |
| GitHub Releases | Unlimited | Unlimited | $0 |
| AI Models | N/A | User's keys/local | $0 |
| Media Storage | N/A | P2P, no cloud | $0 |
| Total | | | $0-5/mo |


## Phase 3 Decision Architecture (Router Agent + Enforcer)

This project uses a two-part routing architecture to stay adaptive without becoming unstable.

1. Router Agent (AI reasoning layer)
- Interprets task intent and constraints (quality, latency, budget, required capabilities).
- Can reason over benchmarks, provider docs, SDK/API updates, and Cost Research Agent outputs.
- Produces ranked recommendations with explicit reasons.

2. Router Enforcer (deterministic safety layer)
- Applies non-negotiable runtime checks before execution.
- Blocks unsafe choices (missing API key, exhausted quota, policy/budget violations).
- Performs deterministic fallback when the recommended model cannot run.

Why this split is required:
- We want dynamic model intelligence, not brittle hardcoded selection logic.
- We also need deterministic runtime safety so production behavior is predictable.
- This prevents failure loops and gives clear user-facing reasons when a choice is blocked.

### Master CEO Decision Loop

- Cost Research Agent updates provider/model/quota state.
- Router Agent generates task-level recommendation candidates.
- Master CEO applies strategic preference (cost vs quality vs speed).
- Enforcer validates and executes only policy-safe choices.

### Parameter Evolution Policy (Self-Improving, Safe)

- Master CEO can propose new routing parameters.
- Arbitrary runtime parameters are not auto-applied.
- New parameters follow: proposal -> schema validation -> policy publish -> canary -> production.
- Routing input is versioned (`schema_version`) for compatibility.

Optional future extension:
- After Phase 3B/3C, add company-level provider key overrides while global instance keys remain default.

Design principle:
- Dynamic intelligence, deterministic safety.

---

## 2026-04-08 Architecture Delta (Current As-Built)

### Master hierarchy runtime
- Protected master agents now include:
  - Master CEO
  - Cost & Provider Research Agent
  - Model Research Router Agent
  - AI News and Releases Agent
- Master-company personnel policy standardizes `canCreateAgents: true` by default at create/hire time.

### Router architecture update
- Model Research Router Agent holds default assignment context (provider/model preference, task-hint-aware recommendation notes).
- Router Enforcer remains deterministic gatekeeper for runtime safety.

### Provider discovery subsystem (implemented)
- Provider-doc discovery pipeline is active:
  - Provider ID -> docs URL discovery
  - controlled crawl of API reference subpages
  - extraction of auth/test/model-list metadata
  - confidence-scored suggestions
- Publish flow is validation-gated:
  - only validated suggestions are published
  - validated metadata is persisted into `api_keys` metadata for runtime consumption.

### UI/runtime guardrail updates
- Discovery suggestions are exposed in UI with evidence/confidence and explicit publish controls.
- Adapter selection is explicit across new-agent, onboarding, invite, and import flows (no implicit Claude default).
- Org-chart tree builder preserves local roots even when `reportsTo` points to a cross-company master manager.

---

## 2026-04-09 Architecture Delta (Phase 4 As-Built)

### Knowledge Base service layer
- `server/src/services/knowledge-base/*` now provides:
  - file manager scaffold/watcher
  - indexer/chunking/embedding fallback
  - semantic search with scoped filtering
  - runtime orchestration
  - policy audit metrics and snapshot persistence

### API surface
- `server/src/routes/knowledge-base.ts` exposes:
  - `search`, `read`, `write`, `list`, `wiki-entry`, `health`, `benchmark`, `policy-metrics`
- Agent calls are scope-gated via `kb_access`; board has full oversight endpoints.

### Policy telemetry + analytics path
- Decision sampling supports:
  - env-configured sampling baseline
  - traffic-aware sampling auto-adjustment
  - always-record safety rules for key deny/critical events
- Persisted analytics actions in `activity_log`:
  - `kb.policy_metrics.snapshot`
  - `kb.policy_metrics.rollup.daily`
  - `kb.policy_metrics.rollup.monthly`
  - `kb.policy_metrics.archive.export`

### UI integration
- New page: `ui/src/pages/KnowledgeBase.tsx` (`/knowledge-base` route).
- Dashboard includes deny-rate trend/action/scope analytics from KB policy metrics.
- Shared i18n provider baseline exists in UI (`ui/src/context/I18nContext.tsx`).
