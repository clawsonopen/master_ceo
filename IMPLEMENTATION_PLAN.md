

# Implementation Plan — Master CEO AI Holding

## Rules for the Coding Agent

1. Work in phases. Do NOT skip ahead.
2. Each phase must compile and pass tests before moving to next phase.
3. Before writing any code, first:
   a. List all files that will be created or modified
   b. Show the change plan
   c. Wait for human approval
4. Write tests for every new feature.
5. Follow Paperclip's existing code style and patterns.
6. All UI text must use i18next translation keys from the start (never hardcoded strings).
7. Never store API keys in plaintext in the database. Always encrypt with AES-256.
8. All TypeScript. No Python in the core application.

---

## Phase 1: Understand Paperclip Codebase (No Code Changes)

### Objective

Map the existing codebase before touching anything.

### Steps

1. Clone and run Paperclip:
   - git clone https://github.com/paperclipai/paperclip.git
   - cd paperclip
   - pnpm install
   - pnpm dev
   - Verify it runs on localhost:3100.

2. Study and document:
   - Database schema: Where are companies, agents, tasks/issues defined?
   - API routes: What endpoints exist for CRUD on companies and agents?
   - Provider/model system: How does Paperclip currently select and use AI models?
   - UI components: Where is the React frontend? What component library and styling?
   - Agent execution: How does the heartbeat/routine system trigger agent actions?
   - Configuration: Where are environment variables and settings stored?
   - File structure: What is the full project directory layout?

3. Create CODEBASE_MAP.md documenting all findings with file paths.

### Success Criteria

- Paperclip runs locally without errors
- CODEBASE_MAP.md is complete and accurate
- All extension points identified

---

## Phase 2: Master Company Hierarchy

### Objective

Add undeletable Master Company with protected agents and parent-child relationships.

### Database Changes

1. Add to companies table:
   - company_type: 'master' or 'regular' (default: 'regular')
   - is_deletable: boolean (default: true)
   - parent_company_id: UUID reference to companies (nullable)
   - Unique partial index: only 1 master company allowed

2. Add to agents table:
   - is_protected: boolean (default: false)
   - hired_by: UUID reference to agents (nullable)
   - skills: JSONB (default: '[]')
   - kb_access: JSONB (default: '{"read":[],"write":[],"search":[]}')
   - model_preference: JSONB (default: '{"mode":"auto"}')

3. Create proper DB migration files following Paperclip's migration pattern.

### API Middleware

4. DELETE /api/companies/:id → Return 403 if company_type === 'master'
5. DELETE /api/agents/:id → Return 403 if is_protected === true
6. POST /api/companies → If company_type === 'master' and one exists → 409 Conflict
7. PUT /api/companies/:id → Cannot change company_type of master company
8. All sub-company operations: Verify parent_company_id chain for authorization

### Seed Data

9. On first application start (migration or seed script):
   - Create "Master Holding Company" (company_type: 'master', is_deletable: false)
   - Create "Master CEO" agent (is_protected: true, linked to Master Company)
   - Create "Cost & Provider Research Agent" (is_protected: true, linked to Master Company)

### UI Changes

10. Master Company shows a crown/shield icon in the company list
11. Delete button hidden for master company and protected agents
12. Company creation form includes parent company selector (defaults to Master)
13. Agent list shows "Protected" badge for protected agents
14. Visual hierarchy: Master Company always appears first in list

### Tests

15. Test: Cannot delete master company via API (expect 403)
16. Test: Cannot delete protected agent via API (expect 403)
17. Test: Can create sub-company under master
18. Test: Sub-company CEO cannot access master company's endpoints
19. Test: Only 1 master company can exist (expect 409 on second creation)
20. Test: Seed creates master company + 2 protected agents on first run

### Success Criteria

- Master Company auto-created on first run
- Master Company and protected agents cannot be deleted via API or UI
- Sub-companies link to master via parent_company_id
- All 6 tests pass

---

## Phase 3: BYOK Model Manager + Cost-Aware Router

### Objective

Users bring their own API keys. System intelligently routes every request to the best available free model, falling back through paid and local models with full cost awareness.

Optional future extension:
- After Phase 3B/3C, we may add "company override keys" so a sub-company can override specific provider keys while global instance keys remain the default.

### Phase 3 Operating Model (Agreed Design)

This phase uses a two-part architecture:

1. Router Agent (AI reasoning layer)
   - Reads task intent, capabilities, latency/cost constraints, and model metadata.
   - Can reason over benchmark updates, provider docs, and internal research outputs.
   - Produces a ranked recommendation with explicit reasons (quality, cost, quota, reliability).

2. Router Enforcer (deterministic safety layer)
   - Applies non-negotiable runtime checks before execution.
   - Guarantees no run starts with missing API key, exhausted quota, or blocked policy.
   - Performs fallback selection when recommended model is unavailable at runtime.

Rationale:
- We want adaptive intelligence without fragile runtime behavior.
- AI reasoning should be dynamic; safety gates must remain deterministic.
- This prevents "dev loop" failures and production incidents caused by ambiguous agent decisions.

#### Responsibilities Split

- Cost Research Agent:
  - Continuously updates provider/model availability, quota signals, and market changes.
  - Writes structured updates that Router Agent can consume.

- Router Agent:
  - Converts task requirements + research state into recommendation proposals.
  - Explains "why this model now" to Master CEO (human-readable decision trace).

- Master CEO:
  - Reviews strategic recommendations and can set preference/policy constraints.

- Router Enforcer:
  - Executes only policy-valid recommendations.
  - Emits clear feedback when blocked (e.g., missing provider key, quota exhausted, policy denied).

#### Parameter Evolution (Self-Improving System)

- Master CEO may propose new routing parameters, but arbitrary free-form parameters are not auto-applied.
- New parameters must pass a schema/policy path:
  1) proposal -> 2) validation -> 3) policy publish -> 4) canary rollout -> 5) production.
- All routing inputs must be versioned (`schema_version`) for backward compatibility.
- Dynamic intelligence is encouraged; runtime safety remains strict.

Design principle:
- Dynamic intelligence, deterministic safety.

### 3A: API Key Management

1. Create api_keys table (see ARCHITECTURE.md schema)
2. Create encryption utility:
   - AES-256-GCM encryption with app-level secret key
   - Encrypt before DB write, decrypt only when making API calls
   - Never log, display, or return full key via API
3. Create API endpoints:
   - POST /api/settings/api-keys — Save encrypted key for provider
   - GET /api/settings/api-keys — Return list with masked keys (last 4 chars only)
   - POST /api/settings/api-keys/:provider/test — Test connection, return success/failure
   - DELETE /api/settings/api-keys/:provider — Remove key
4. Create Settings > API Keys page in React UI:
   - Input fields for 9 providers: Gemini, OpenRouter, Groq, Cerebras, Mistral, GitHub Models, NVIDIA NIM, OpenAI, Anthropic
   - Each field has help link to provider's key generation page
   - "Test Connection" button per provider with success/failure badge
   - Save button
   - Info banner: "All keys are encrypted. You can start without any keys using local Gemma 4 and free-tier models."

### 3B: Provider Registry

5. Create provider_registry table (see ARCHITECTURE.md schema)
6. Seed with all known free models from ARCHITECTURE.md provider table
7. Create ProviderRegistry class:
   - getAllModels(): List all models with current status
   - getFreeModels(): Filter to free-only active models
   - getModelsByCapability(needs): Smart filter by tools, vision, minContext, maxCost
   - updateModel(provider, modelId, data): Update model info (used by Cost Research Agent)
   - addModel(data): Add new model (used by Cost Research Agent)
   - deactivateModel(provider, modelId): Mark model as inactive

### 3C: Quota Tracker

8. Create quota_tracker table (see ARCHITECTURE.md schema)
9. Create QuotaTracker class:
   - recordUsage(provider, model): Increment used_today counter
   - checkQuota(provider, model): Returns remaining, limit, percentUsed
   - record429(provider, model): Log rate limit hit timestamp
   - resetDaily(): Reset all daily counters (scheduled at midnight)
   - getOpenRouterBalance(): Call OpenRouter /api/v1/auth/key for real-time balance
   - getGroqUsage(): Check Groq usage endpoint
   - getAllQuotas(): Return full quota status across all providers
   - getQuotaSummary(): Human-readable summary for cost reports

### 3D: Model Router (THE KILLER FEATURE)

10. Create ModelRouter class implementing the 7-tier decision flow:
    - selectModel(task): Walk through tiers, check quotas, return best available model. Task includes description, complexity, and requiredCapabilities.
    - analyzeComplexity(taskDescription): Use cheapest available model (Tier 0/1) to score task complexity 1-10
    - handleFallback(failedProvider, failedModel, task): On 429 or error, move to next model in tier, log the fallback
    - generateCostReport(): Natural language summary of all quotas, balances, recommendations
    - negotiateWithUser(task, availableOptions): When paid models needed, present options in natural conversational language
11. Integrate ModelRouter into Paperclip's existing provider system:
    - Every agent API call goes through ModelRouter.selectModel() first
    - ModelRouter wraps the actual API call with retry + fallback logic
    - On 429: automatic fallback to next model, no user intervention
    - On success: record usage in QuotaTracker
    - Emit events: 'model_selected', 'fallback_triggered', 'quota_low', 'quota_exhausted'

### 3E: Ollama Integration (Local Models)

12. Create OllamaProvider:
    - Auto-detect if Ollama is running on localhost:11434
    - List available local models via Ollama /api/tags endpoint
    - Expose as OpenAI-compatible provider to ModelRouter
    - Health check: periodic ping to Ollama, update status in UI
    - Model pull: trigger ollama pull via IPC, show progress in UI

### 3F: Background Quota Refresh

13. Create periodic background task (setInterval, 5-minute cycle):
    - Refresh all quotas from provider APIs
    - Update quota_tracker table
    - If any provider's quota changed significantly → emit event
    - If paid balance dropped below $0.25 → trigger auto-downgrade
    - If daily reset happened → upgrade available tiers

### 3G: Cost Dashboard UI

14. Create Cost Dashboard page in React UI:
    - Visual quota bars for each provider
    - Current tier indicator
    - Recent model selections log
    - Fallback history
    - "Model Preferences" panel (auto vs manual selection)
    - When manual: user can lock a specific model for next N tasks

### Tests

15. Test: Model selection returns free model for complexity 1-3
16. Test: Model selection returns higher-tier model for complexity 7+
17. Test: Fallback triggers correctly when quota exhausted (mock 429)
18. Test: API key encryption/decryption round-trip preserves key
19. Test: OpenRouter balance check parses response correctly
20. Test: Ollama detection works when running and when not running
21. Test: Cost report generation with mock quota data produces valid text
22. Test: 5-minute refresh updates quota_tracker correctly
23. Test: Provider registry CRUD operations work correctly
24. Test: Manual model override locks selection for specified tasks

### Success Criteria

- User can add/remove/test API keys for all 9 providers
- System selects best free model by default for any complexity level
- 7-tier fallback chain works end-to-end with automatic 429 recovery
- 5-minute quota refresh runs in background
- Natural language cost reports generated on demand
- Cost Dashboard shows real-time quota status
- Manual model override available when user wants control

---

## Phase 4: Knowledge Base

### Objective

Hybrid Karpathy LLM Wiki + SQLite-Vec semantic search with scoped access control and automatic indexing.

### 4A: File System Layer

1. Create /KnowledgeBase/ directory structure (as in ARCHITECTURE.md)
2. On first run, scaffold all directories and template files:
   - /Global_Holding/raw/, /wiki/, /policies/, /model_research/
   - /Intelligence/raw/, /wiki/, /sources.yaml
   - Template index.md and log.md in each /wiki/ directory
3. Create KBFileManager class:
   - writeDocument(relativePath, content): Write .md file, ensure directory exists
   - readDocument(relativePath): Read .md file, return content
   - listDocuments(directory): List all .md files recursively
   - watchDirectory(path, callback): File watcher (chokidar) for auto-indexing
   - getScope(filePath): Extract scope from file path
   - ensureCompanyStructure(companyName): Create company directory scaffold
   - ensureProjectStructure(companyName, projectName): Create project scaffold

### 4B: SQLite-Vec Index Layer

4. Initialize SQLite database at /KnowledgeBase/memory.db
5. Create schema: nodes, chunks, edges, vec_chunks (see ARCHITECTURE.md)
6. Create KBIndexer class:
   - indexDocument(filePath): Read, split into chunks, embed, store in DB
   - removeDocument(filePath): Remove all chunks and vectors for file
   - updateDocument(filePath): Check content_hash, re-index only if changed
   - indexAll(): Full reindex of all .md files in KnowledgeBase
   - getStats(): Return counts of nodes, chunks, scopes
7. Chunking strategy:
   - Split by paragraphs (double newline)
   - Each chunk: 200-500 tokens
   - Overlap: 50 tokens between chunks for context continuity
8. Embedding provider with fallback:
   - Primary: Gemini text-embedding-004 API (if key available, 768 dimensions)
   - Fallback 1: Ollama Gemma 4 embeddings (local, free, always available)
   - Fallback 2: OpenRouter free embedding model
   - Fallback 3: Simple TF-IDF with cosine similarity (no external dependency)

### 4C: Semantic Search

9. Create KBSearcher class:
   - search(query, scopes, limit): Embed query, vec_distance_cosine, filter by scopes, return ranked results
   - searchWithContext(query, scopes, limit): Search + load surrounding chunks for better context
   - Results include: file_path, scope, content snippet, similarity score, title
   - Cache recent query embeddings to avoid re-embedding same queries

### 4D: Paperclip Tool Integration

10. Register new agent tools:
    - search_knowledge_base(query, scopes): Semantic search within allowed scopes
    - read_knowledge_base(path): Read specific file (scope check)
    - write_knowledge_base(path, content): Write file + auto-index (scope check)
    - list_knowledge_base(directory): List files in directory (scope check)
    - create_wiki_entry(scope, title, content): Create new wiki page with proper structure
11. Access control: Every tool call validates agent's kb_access against requested scope
    - Read requires scope in agent's kb_access.read or kb_access.search
    - Write requires scope in agent's kb_access.write
    - Unauthorized access returns error message, does not throw

### 4E: Auto-Indexing

12. File watcher on /KnowledgeBase/ using chokidar:
    - New .md file → auto-index to SQLite-Vec
    - Modified .md file → check content_hash → re-index if changed
    - Deleted .md file → remove from SQLite-Vec index
13. Auto-update log.md files (Karpathy pattern):
    - When any file in a /wiki/ directory changes → append entry to that wiki's log.md
    - Format: [YYYY-MM-DD HH:mm] {agent_name}: {action} {file_path}

### Tests

14. Test: Write document → verify it appears in SQLite-Vec index
15. Test: Search returns relevant results within scope
16. Test: Search does NOT return results outside agent's allowed scopes
17. Test: File update triggers re-indexing (content_hash changes)
18. Test: Embedding fallback chain works (mock each provider failing)
19. Test: Auto-indexing fires on new file creation
20. Test: log.md auto-updated when wiki files change

### Success Criteria

- Knowledge Base directory structure created on first run
- Documents auto-indexed when created or modified
- Semantic search works with scope filtering
- Agents can only access scopes defined in their kb_access
- Multiple embedding providers with automatic fallback
- log.md files auto-updated on changes

---

## Phase 5: Hermes-Agent CEO Integration + Cost Research Agent Activation

### Objective

Company CEOs are autonomous agents that can hire/fire workers, manage projects, install skills, and select models. Cost Research Agent actively scans all providers.

### 5A: CEO Agent Core (TypeScript Port)

1. Port Hermes-Agent's core reasoning loop to TypeScript:
   - SOUL.md parser: Read agent persona/instructions from markdown
   - Tool execution loop: Reason, select tool, execute, observe, repeat
   - Hermes prompt format compatibility with all models via ModelRouter
   - This avoids Python dependency for end-users
2. If full port is too complex initially:
   - Create HTTP bridge: Paperclip sends HTTP POST to Hermes-Agent Python process in WSL2, receives response
   - Document WSL2 setup for development
   - Plan TypeScript port for later phase

### 5B: CEO Capabilities (Paperclip Tools)

3. Implement CEO-specific tools:
   - hire_agent(name, skills, kb_access, model_preference): Create new agent under CEO's company with specified configuration. Validate CEO can only hire within own company.
   - fire_agent(agent_id): Remove agent. Validate only own company and not protected.
   - create_project(name, description): Create project directory structure with wiki scaffold. Register project in projects table. Auto-index initial wiki files.
   - assign_task(agent_id, task_description, priority): Create issue/ticket for specified agent. Validate agent must be in CEO's company.
   - select_model_for_agent(agent_id, model_preference): Set model preference for agent within CEO's allowed budget tier.
   - get_company_status(): Return agents list, active projects, recent tasks, quota usage.
   - request_skill_install(agent_id, skill_source, skill_name): Download and install skill from marketplace.

### 5C: Skill Marketplace Integration

4. Create SkillManager class:
   - searchSkills(query, source): Search skills.sh, ClawHub, GitHub
   - installSkill(agentId, skillPackage): Download, validate, install
   - listInstalledSkills(agentId): Return agent's current skills
   - removeSkill(agentId, skillName): Uninstall skill from agent
   - validateSkill(skillPackage): Check compatibility and safety
5. Skill sources:
   - Built-in skills: file_read, file_write, terminal_exec, http_request, json_parse, git_commit, search_knowledge_base, write_knowledge_base
   - skills.sh marketplace
   - ClawHub
   - GitHub repos (as installable skill packages)

### 5D: Cost & Provider Research Agent Activation

6. Activate the Cost Research Agent (seeded in Phase 2) with its SOUL.md. The agent's mission is to ensure the organization always uses the best available AI models at the lowest possible cost. Its daily routine at 04:00 includes scanning OpenRouter API for free model changes, checking Google AI Studio model availability, checking Groq, Cerebras, Mistral, GitHub Models, and NVIDIA NIM, comparing findings with current provider_registry, flagging new free models, removed models, quota changes, and pricing changes, writing reports to /Global_Holding/model_research/, updating provider_registry and quota_tracker databases, and notifying Master CEO if significant changes found. On demand, it generates full cost analysis when Master CEO asks, and investigates alternatives when any CEO reports model issues.

7. Daily routine implementation:
   - GET https://openrouter.ai/api/v1/models → parse free models → diff with registry
   - For each provider with API key: query model listing endpoints
   - Optional: Crawl4AI scan of provider pricing pages for changes
   - Write report: /Global_Holding/model_research/daily_scan_YYYY-MM-DD.md
   - Update provider_registry: add new models, deactivate removed ones
   - Update quota_tracker: refresh limits from API responses
   - If significant change → create issue for Master CEO with summary

### 5E: Project Management

8. CEO creates project via create_project tool. The resulting directory structure under /Companies/{company}/projects/{project_name}/ includes:
   - /wiki/index.md (auto-generated from project description)
   - /wiki/log.md (empty template, ready for logging)
   - /wiki/todo.md (auto-generated from initial task breakdown)
   - /raw/ (empty, ready for research)
   - /code/ (empty, ready for source code)
9. Auto-index new project wiki files in SQLite-Vec with project-specific scope
10. Agents assigned to project automatically get project scope in kb_access

### 5F: AutoResearch Ratchet Pattern

11. Each project follows Karpathy's autoresearch improvement loop:
    - wiki/index.md serves as program.md equivalent (what to achieve)
    - Agent makes changes, records in wiki/log.md with timestamp
    - CEO evaluates: improvement leads to keeping changes, regression leads to revert
    - Log format example:
      - [2026-04-06 14:32] developer_agent: Modified /code/api.ts — added auth middleware
      - [2026-04-06 14:33] ceo_agent: Reviewed change — ACCEPTED (improves security)
      - [2026-04-06 15:10] developer_agent: Modified /code/api.ts — refactored routes
      - [2026-04-06 15:12] ceo_agent: Reviewed change — REVERTED (broke 2 tests)

### Tests

12. Test: CEO can hire agent with specific skills and kb_access
13. Test: CEO cannot hire agent in another company (expect 403)
14. Test: CEO cannot fire protected agent (expect 403)
15. Test: Hired agent has correct kb_access scope after creation
16. Test: Cost Research Agent scans OpenRouter and correctly identifies free models
17. Test: Project creation scaffolds correct directory structure
18. Test: New project wiki files auto-indexed in Knowledge Base
19. Test: Skill installation from mock marketplace works
20. Test: AutoResearch log.md format is correct

### Success Criteria

- CEO agents can autonomously hire/fire agents within their company
- CEOs can create projects with proper wiki scaffold
- Skills installable from external sources
- Cost Research Agent runs daily and updates provider_registry
- Projects have their own searchable mini-wikis
- AutoResearch ratchet pattern visible in project log.md

---

## Phase 6: Intelligence Department

### Objective

Autonomous internet research agent that replaces manual browsing. Crawls sources nightly, indexes findings, generates morning briefs.

### 6A: Research Tools

1. Integrate Crawl4AI for web scraping:
   - Input: URL → Output: clean markdown content
   - Blog posts, articles, documentation → clean markdown
   - GitHub READMEs and release notes → markdown
2. Integrate yt-dlp for YouTube:
   - Download transcript (not video) for specified channels
   - Convert to markdown with timestamps
3. GitHub API integration:
   - Watch specific repos for new releases, issues, PRs
   - Track trending repos in specified topics
4. RSS feed parser for blogs

### 6B: Source Management

5. Source configuration file at /Intelligence/sources.yaml containing:
   - youtube_channels: list of channel handles
   - x_accounts: list of account handles
   - github_repos: list of owner/repo strings
   - github_topics: list of topic strings
   - rss_feeds: list of feed URLs
   - keywords: list of interest keywords
6. UI page for managing sources (add/remove/enable/disable)

### 6C: Nightly Research Routine

7. Scheduled routine (cron at 03:00):
   - For each source: fetch content published since last check
   - Relevance filter using cheapest model (local Gemma 4): "Is this content relevant to the user's interests? Score 1-10."
   - Score >= 5: Save to /Intelligence/raw/YYYY-MM-DD_{source}_{title}.md
   - Auto-index saved files to SQLite-Vec with scope 'intelligence'
   - Update /Intelligence/wiki/log.md with scan summary

### 6D: Morning Brief

8. Scheduled routine (cron at 08:00):
   - Compile all new /Intelligence/raw/ files from last 24 hours
   - Generate summary using mid-tier model (Gemini Flash or equivalent)
   - Write to /Intelligence/wiki/daily_brief_YYYY-MM-DD.md
   - Notify Master CEO: "Morning brief ready. N new items found."
   - Brief format includes sections for High Priority, Noteworthy, Background, and Provider Updates from Cost Research Agent

### 6E: On-Demand Research

9. Any CEO can request: "Research {topic}"
   - Intelligence Agent searches existing KB first
   - If insufficient: crawls web using Crawl4AI
   - Saves new findings to /Intelligence/raw/
   - Returns synthesized summary to requesting CEO
   - Auto-indexed for future queries

### Tests

10. Test: YouTube transcript extraction produces valid markdown
11. Test: Web page crawl with Crawl4AI produces clean markdown
12. Test: Source scanning respects sources.yaml configuration
13. Test: Relevance filter correctly scores content
14. Test: Morning brief generated from raw documents
15. Test: On-demand research returns results and indexes them

### Success Criteria

- Nightly research runs automatically at 03:00
- Results indexed and searchable in Knowledge Base
- Morning brief generated daily at 08:00
- Any CEO can trigger on-demand research
- Sources manageable via UI and sources.yaml

---

## Phase 7: Electron Desktop Packaging

### Objective

Single EXE (Windows) / DMG (macOS) installer with guided onboarding, system tray operation, subprocess management, and auto-updates.

### 7A: Electron Project Setup

1. Initialize Electron project in repository root:
   - Use electron-forge or electron-builder boilerplate
   - Main process: src/electron/main.ts
   - Preload script: src/electron/preload.ts
   - Renderer: Paperclip's existing React app
2. Main process responsibilities:
   - Start Paperclip server (Express/Fastify) as embedded process on localhost:3100
   - Manage Ollama subprocess (start/stop/health check via child_process.spawn)
   - Manage cloudflared subprocess (start/stop/get tunnel URL)
   - System tray icon with menu: Open Dashboard, Status submenu showing running services, Check for Updates, Quit with graceful shutdown of all subprocesses
   - Auto-updater: check GitHub Releases on startup
3. IPC Bridge (main to renderer communication):
   - system:getInfo — returns CPU, RAM, GPU, disk, OS info via systeminformation package
   - ollama:status — returns running/stopped and models list
   - ollama:pullModel — accepts model name, streams download progress
   - ollama:listModels — returns installed models
   - ollama:start — starts ollama serve process
   - ollama:stop — stops ollama process
   - tunnel:start — starts cloudflared named tunnel
   - tunnel:stop — stops tunnel
   - tunnel:getUrl — returns current tunnel URL
   - app:checkUpdate — checks GitHub Releases for new version
   - app:getVersion — returns current app version

### 7B: Onboarding Wizard

4. Create React component: OnboardingWizard (displayed on first run only)
   - Step 1: Welcome + Language selection (Turkce / English)
   - Step 2: Hardware detection via IPC system:getInfo call. Analyze RAM total, GPU VRAM, free disk space. Recommend Gemma 4 variant based on hardware: 32GB RAM + 12GB+ VRAM recommends gemma4:26b, 16GB RAM recommends gemma4:e4b, 8GB RAM recommends gemma4:e2b, less than 8GB RAM skips local and uses cloud only. Display recommendation with explanation. Options: Install recommended, Choose different, Skip.
   - Step 3: Model download (if selected). Ensure Ollama is installed (auto-install if bundled). Call IPC ollama:pullModel with progress streaming. Show download progress bar with size/speed/ETA. On complete show confirmation.
   - Step 4: API keys (all optional). Each provider has input field + help link + test button. Clear messaging that no keys are required to start. Skip all button prominently displayed.
   - Step 5: Complete. Master Company created if not already. Master CEO + Cost Research Agent assigned. First task auto-created to scan all providers. Redirect to Paperclip Dashboard.

### 7C: Auto-Updater

5. Configure electron-updater with GitHub Releases:
   - Check for updates on app startup (silent)
   - If update found → system tray notification
   - User clicks → download in background
   - Download complete → prompt to restart
   - On restart → new version runs
   - No code signing initially (Windows SmartScreen warning acceptable)
   - Add code signing later when user base grows

### 7D: Build Configuration

6. electron-builder configuration:
   - appId: com.masterceo.app
   - productName: Master CEO
   - Windows target: nsis
   - macOS target: dmg with category public.app-category.productivity
   - Linux target: AppImage
   - extraResources: platform-specific ollama binary and cloudflared binary
   - publish: GitHub provider pointing to your repo

### Tests

7. Test: Electron app starts, Paperclip server accessible on localhost:3100
8. Test: System tray icon appears with correct menu items
9. Test: IPC system:getInfo returns valid hardware data
10. Test: IPC ollama:status correctly reports running/stopped
11. Test: Onboarding wizard displays on first run, not on subsequent runs
12. Test: Model recommendation matches hardware specs
13. Test: Auto-updater detects mock new version

### Success Criteria

- Single .exe installer for Windows works end-to-end
- Single .dmg for macOS works end-to-end
- Guided onboarding with hardware detection and model recommendation
- Gemma 4 auto-installation via Ollama subprocess
- System tray with background operation
- Auto-update mechanism checks GitHub Releases

---

## Phase 8: Mobile Access

### Objective

Access Paperclip dashboard from phone via Tailscale or Cloudflare Tunnel.

### 8A: Tailscale Integration

1. Settings page section: "Mobile Access"
   - Instructions to install Tailscale on PC and phone
   - Display current Tailscale IP (if detected)
   - One-click "Copy access URL" button with the Tailscale IP and port 3100
   - Connection test: ping from UI to verify tunnel is working

### 8B: PWA Configuration

2. Add Progressive Web App support to Paperclip React UI:
   - manifest.json with app name, icons, theme color
   - Service worker for basic caching (offline: show "reconnecting" page)
   - Responsive CSS adjustments for mobile viewports
   - Touch-friendly button sizes and spacing
3. "Add to Home Screen" instructions displayed on mobile browser

### 8C: Cloudflare Named Tunnel (Future)

4. Preparation only (UI hooks, not full implementation):
   - Settings page: "Cloudflare Tunnel" section
   - cloudflared binary already bundled from Phase 7
   - Configuration UI for named tunnel setup
   - Full implementation when user base grows

### Tests

5. Test: PWA manifest loads correctly
6. Test: Service worker registers and caches shell
7. Test: UI responsive at 375px, 414px, 768px widths
8. Test: Tailscale IP detection works when Tailscale is running

### Success Criteria

- Phone can access Paperclip via Tailscale
- PWA installable on phone home screen
- UI fully usable on mobile screens
- Instructions clear and complete for non-technical users

---

## Phase 9: Internationalization (Turkish)

### Objective

Full Turkish language support for all UI elements and agent communication.

### 9A: i18next Setup

1. Install and configure i18next + react-i18next
2. Create translation files:
   - src/i18n/locales/en.json (English — extract all existing hardcoded strings)
   - src/i18n/locales/tr.json (Turkish translations)
3. Language detection: use language selected in onboarding (stored in settings)
4. Hot-switch: changing language in settings updates UI immediately

### 9B: String Extraction

5. Go through ALL React components and replace hardcoded strings with t() calls:
   - Navigation labels
   - Button text
   - Form labels and placeholders
   - Error messages
   - Success messages
   - Onboarding wizard text
   - Cost dashboard labels
   - Knowledge Base UI labels
   - Settings page labels

### 9C: Agent Language

6. Agent communication language preference:
   - Store user's preferred language in settings
   - Agents include language instruction in their prompts
   - Cost reports, morning briefs, negotiation messages all in selected language
   - SOUL.md files can be written in either language

### 9D: Knowledge Base Language

7. Knowledge Base can contain documents in any language
8. Search works regardless of document language (embedding-based, language-agnostic)
9. Auto-generated wiki entries (index.md, log.md) use selected language

### Tests

10. Test: All UI strings have translation keys (no hardcoded strings)
11. Test: Switching language updates all visible text
12. Test: Agent cost report generated in Turkish when Turkish selected
13. Test: Onboarding wizard displays correctly in both languages

### Success Criteria

- All UI text available in Turkish and English
- Language switchable in settings with immediate effect
- Agents communicate in selected language
- No hardcoded strings remaining in React components

---

## 2026-04-08 Current State (Supersedes prior Phase 3A-only note)

### Completed in codebase
- Master hierarchy now has 4 protected agents:
  - `Master CEO`
  - `Cost & Provider Research Agent`
  - `Model Research Router Agent`
  - `AI News and Releases Agent`
- Master-company personnel defaults:
  - create/hire paths default to `canCreateAgents: true` in `company_type = master`
  - protected instruction editing is supported with warning + explicit unlock flow
- Provider discovery (Phase 3B) is implemented end-to-end:
  - crawl/discovery worker
  - API reference parsing
  - auth/test/model endpoint extraction
  - confidence scoring
  - publish validation gate
  - validated publish into `api_keys` metadata
- Discovery UI is implemented:
  - Provider Discovery Suggestions
  - Discover / Refresh / Filter / Publish
  - confidence + evidence rendering
- Default instruction materialization updated:
  - managed bundles include `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`, `SKILLS.md`
  - regular-company defaults include `TOOLS.md` template and rationale text
- Runtime adapter selection hardening:
  - implicit `claude_local` fallbacks removed in create/onboarding/invite/import flows
  - explicit adapter choice is required in UI
- Org/pending-approval behavior finalized:
  - pending assignment block is tied to `requireBoardApprovalForNewAgents` (not API key availability)
  - org tree preserves local roots when manager is cross-company (master)
  - pending-approval conflict messages now include actionable guidance

### Remaining from this plan
- Phase 4 is complete as of 2026-04-09 (feature + hardening pass).
- Remaining roadmap starts from Phase 5 onward.

---

## 2026-04-09 Phase 4 Completion Addendum

### Completed (as-built)
- Knowledge Base runtime and filesystem scaffold are implemented.
- SQLite memory integration is implemented with sqlite-vec support and safe fallback path.
- Indexer/chunking/embedding fallback and semantic search with scope filtering are implemented.
- Paperclip KB tool/route surface is implemented (`search/read/write/list/wiki-entry/health/benchmark`).
- Access control guardrails and watcher-based auto-indexing are implemented.
- Policy audit metrics pipeline is implemented (sampling + snapshots + retention + rollup + archive export).
- Dashboard policy cards are implemented (deny trend + deny by action + deny by scope).
- KB UI File Manager is implemented (`/knowledge-base`) with i18n-friendly key-based text usage.

### Hardening completed
- Route integration coverage expanded for deny/success flows (read/list/wiki-entry).
- KB UI regression tests added for search/save interactions.
- sqlite-vec benchmark report captured (vec-required vs fallback comparison):
  - `paperclip/report/2026-04-09-kb-sqlite-vec-benchmark.md`
- Global UI i18n standardization baseline added:
  - central `I18nProvider`
  - shared message catalog + translation utility layer

### Residual risks (known, accepted)
- sqlite-vec may not outperform fallback in tiny smoke datasets; benefit is expected with larger corpora.
- Full app-wide i18n migration is not complete yet; baseline framework is now in place.
