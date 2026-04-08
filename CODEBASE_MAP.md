# CODEBASE_MAP.md — Paperclip Codebase Analysis

> Phase 1 deliverable. Analysis based on the `paperclip/` directory (git clone of paperclipai/paperclip).
> **Zero code changes.** This document maps the existing system to identify extension points for Master CEO.

---

## 1. File Structure (Directory Layout)

```
paperclip/
├── cli/                          # CLI tools (auth bootstrap, etc.)
├── doc/                          # Internal documentation
├── docs/                         # Public documentation
├── evals/                        # Evaluation harnesses
├── packages/
│   ├── adapter-utils/            # Shared adapter utilities
│   ├── adapters/                 # AI provider adapter packages
│   │   ├── claude-local/         # Claude Code CLI adapter
│   │   ├── codex-local/          # OpenAI Codex CLI adapter
│   │   ├── cursor-local/         # Cursor CLI adapter
│   │   ├── gemini-local/         # Gemini CLI adapter
│   │   ├── openclaw-gateway/     # OpenClaw cloud gateway adapter
│   │   ├── opencode-local/       # OpenCode CLI adapter
│   │   └── pi-local/             # Pi CLI adapter
│   ├── db/                       # Database package (Drizzle ORM + PostgreSQL)
│   │   └── src/
│   │       ├── schema/           # 62 Drizzle table definitions
│   │       ├── migrations/       # 50 SQL migration files (0000–0049)
│   │       ├── client.ts         # DB client creation (embedded or external PG)
│   │       ├── seed.ts           # Initial seed data
│   │       ├── migrate.ts        # Migration runner
│   │       └── backup-lib.ts     # Database backup logic
│   ├── plugins/
│   │   ├── sdk/                  # Plugin SDK for extension authors
│   │   ├── create-paperclip-plugin/  # Plugin scaffolding tool
│   │   └── examples/             # Example plugins
│   └── shared/                   # Shared types, constants, validators
│       └── src/
│           ├── index.ts          # Zod schemas, shared types (~18KB)
│           ├── constants.ts      # System-wide constants (~20KB)
│           └── types/            # TypeScript type definitions
├── server/
│   └── src/
│       ├── app.ts                # Express app factory (route mounting)
│       ├── index.ts              # Server bootstrap (~30KB, startup logic)
│       ├── config.ts             # Configuration loading (env + file)
│       ├── adapters/             # Server-side adapter registry + loaders
│       │   ├── registry.ts       # Central adapter registry (10 builtin adapters)
│       │   ├── codex-models.ts   # Dynamic Codex model list
│       │   ├── cursor-models.ts  # Dynamic Cursor model list
│       │   ├── plugin-loader.ts  # External adapter plugin loader
│       │   ├── http/             # HTTP-based adapter bridge
│       │   └── process/          # Process-based adapter bridge
│       ├── auth/                 # Authentication (BetterAuth integration)
│       ├── middleware/           # Express middleware (logger, auth, validation)
│       ├── routes/               # 26 Express route files
│       ├── services/             # 72 service files (business logic)
│       ├── secrets/              # Secret management (encrypted storage)
│       ├── storage/              # File storage (local disk or S3)
│       ├── realtime/             # SSE-based live event streaming
│       └── types/                # Server-specific type definitions
├── ui/
│   └── src/
│       ├── App.tsx               # Root React component with routing
│       ├── main.tsx              # React DOM mount + providers
│       ├── index.css             # Global styles (~21KB)
│       ├── pages/                # 43 page-level React components
│       ├── components/           # 98 reusable UI components
│       ├── api/                  # API client functions
│       ├── context/              # React context providers
│       ├── hooks/                # Custom React hooks
│       ├── lib/                  # Utility functions
│       ├── plugins/              # Plugin UI rendering
│       └── adapters/             # UI-side adapter helpers
├── skills/                       # Built-in skill definitions
├── tests/                        # Integration tests
├── scripts/                      # Build and utility scripts
├── docker/                       # Docker configuration
├── patches/                      # Dependency patches
├── package.json                  # Root package.json (pnpm workspace)
├── pnpm-workspace.yaml           # Workspace definition
├── tsconfig.base.json            # Shared TypeScript config
└── vitest.config.ts              # Test configuration
```

### Key Facts
- **Monorepo** managed by pnpm workspaces
- **ORM**: Drizzle ORM (type-safe, schema-first)
- **Server**: Express.js with TypeScript
- **UI**: React 18 + Vite, component library based on Radix UI primitives
- **Database**: PostgreSQL (embedded via `embedded-postgres` or external)
- **Default port**: 3100

---

## 2. Database Schema (62 Tables)

All schemas defined in `packages/db/src/schema/` using Drizzle ORM.

### Core Entity Tables

#### `companies`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `defaultRandom()` |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | |
| `status` | TEXT | Default: `'active'` |
| `pause_reason` | TEXT | |
| `paused_at` | TIMESTAMPTZ | |
| `issue_prefix` | TEXT | NOT NULL, unique index, default `'PAP'` |
| `issue_counter` | INTEGER | Default: 0 |
| `budget_monthly_cents` | INTEGER | Default: 0 |
| `spent_monthly_cents` | INTEGER | Default: 0 |
| `require_board_approval_for_new_agents` | BOOLEAN | Default: true |
| `feedback_data_sharing_enabled` | BOOLEAN | Default: false |
| `feedback_data_sharing_consent_at` | TIMESTAMPTZ | |
| `feedback_data_sharing_consent_by_user_id` | TEXT | |
| `feedback_data_sharing_terms_version` | TEXT | |
| `brand_color` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

> **EXTENSION POINT**: No `company_type`, `is_deletable`, or `parent_company_id` columns. These must be added for Master CEO hierarchy.

#### `agents`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `defaultRandom()` |
| `company_id` | UUID FK → companies | NOT NULL |
| `name` | TEXT | NOT NULL |
| `role` | TEXT | Default: `'general'` — existing values include `'ceo'` |
| `title` | TEXT | |
| `icon` | TEXT | |
| `status` | TEXT | Default: `'idle'` — values: idle, running, paused, error, pending_approval, terminated |
| `reports_to` | UUID FK → agents (self-ref) | Agent hierarchy |
| `capabilities` | TEXT | |
| `adapter_type` | TEXT | Default: `'process'` — links to adapter registry |
| `adapter_config` | JSONB | Provider-specific configuration |
| `runtime_config` | JSONB | Heartbeat/execution settings |
| `budget_monthly_cents` | INTEGER | Default: 0 |
| `spent_monthly_cents` | INTEGER | Default: 0 |
| `pause_reason` | TEXT | |
| `paused_at` | TIMESTAMPTZ | |
| `permissions` | JSONB | `{ canCreateAgents: boolean }` |
| `last_heartbeat_at` | TIMESTAMPTZ | |
| `metadata` | JSONB | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

> **EXTENSION POINT**: No `is_protected`, `hired_by`, `skills`, `kb_access`, or `model_preference` columns. However, the existing `role` field already supports `'ceo'` value, and `reports_to` self-reference already enables org hierarchy.

#### `projects`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | NOT NULL |
| `goal_id` | UUID FK → goals | |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | |
| `status` | TEXT | Default: `'backlog'` |
| `lead_agent_id` | UUID FK → agents | |
| `target_date` | DATE | |
| `color` | TEXT | |
| `pause_reason` / `paused_at` | | |
| `execution_workspace_policy` | JSONB | Workspace configuration |
| `archived_at` | TIMESTAMPTZ | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

#### `issues` (Task/Ticket System)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | NOT NULL |
| `project_id` | UUID FK → projects | |
| `project_workspace_id` | UUID FK → project_workspaces | |
| `goal_id` | UUID FK → goals | |
| `parent_id` | UUID FK → issues (self-ref) | Sub-tasks |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | |
| `status` | TEXT | Default: `'backlog'` — values: backlog, todo, in_progress, in_review, blocked, done, cancelled |
| `priority` | TEXT | Default: `'medium'` |
| `assignee_agent_id` | UUID FK → agents | |
| `assignee_user_id` | TEXT | |
| `checkout_run_id` | UUID FK → heartbeat_runs | |
| `execution_run_id` | UUID FK → heartbeat_runs | Active execution |
| `execution_agent_name_key` | TEXT | |
| `execution_locked_at` | TIMESTAMPTZ | |
| `created_by_agent_id` | UUID FK → agents | |
| `created_by_user_id` | TEXT | |
| `issue_number` | INTEGER | |
| `identifier` | TEXT | Unique, e.g. `PAP-42` |
| `origin_kind` | TEXT | Default: `'manual'` — or `'routine_execution'` |
| `origin_id` | TEXT | Links back to routine |
| `origin_run_id` | TEXT | |
| `request_depth` | INTEGER | Default: 0 |
| `billing_code` | TEXT | |
| `assignee_adapter_overrides` | JSONB | |
| `execution_workspace_id` | UUID FK → execution_workspaces | |
| `execution_workspace_preference` | TEXT | |
| `execution_workspace_settings` | JSONB | |
| `started_at` / `completed_at` / `cancelled_at` / `hidden_at` | TIMESTAMPTZ | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

#### `goals`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | |
| `level` | TEXT | Default: `'task'` |
| `status` | TEXT | Default: `'planned'` |
| `parent_id` | UUID FK → goals (self-ref) | |
| `owner_agent_id` | UUID FK → agents | |

### Routine/Scheduling Tables

#### `routines`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | NOT NULL, CASCADE |
| `project_id` | UUID FK → projects | NOT NULL, CASCADE |
| `goal_id` | UUID FK → goals | |
| `parent_issue_id` | UUID FK → issues | |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | Template with variable interpolation |
| `assignee_agent_id` | UUID FK → agents | NOT NULL |
| `priority` | TEXT | Default: `'medium'` |
| `status` | TEXT | Default: `'active'` |
| `concurrency_policy` | TEXT | Default: `'coalesce_if_active'` — also `skip_if_active`, `always_enqueue` |
| `catch_up_policy` | TEXT | Default: `'skip_missed'` |
| `variables` | JSONB | `RoutineVariable[]` — typed variable definitions |
| `created_by_agent_id` / `created_by_user_id` | | |
| `last_triggered_at` / `last_enqueued_at` | TIMESTAMPTZ | |

#### `routine_triggers`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `routine_id` | UUID FK → routines | CASCADE |
| `kind` | TEXT | `'schedule'`, `'webhook'`, `'manual'`, `'api'` |
| `cron_expression` | TEXT | Standard 5-field cron |
| `timezone` | TEXT | |
| `next_run_at` | TIMESTAMPTZ | |
| `enabled` | BOOLEAN | Default: true |
| `public_id` | TEXT | Unique, for webhook addressing |
| `secret_id` | UUID FK → company_secrets | Webhook auth |
| `signing_mode` | TEXT | |

#### `routine_runs`
Tracks each execution of a routine (received → issue_created / coalesced / skipped / completed / failed).

### Heartbeat/Execution Tables

#### `heartbeat_runs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | |
| `agent_id` | UUID FK → agents | |
| `invocation_source` | TEXT | Default: `'on_demand'` |
| `trigger_detail` | TEXT | |
| `status` | TEXT | Default: `'queued'` — values: queued, running, finished, error |
| `started_at` / `finished_at` | TIMESTAMPTZ | |
| `error` | TEXT | |
| `exit_code` | INTEGER | |
| `signal` | TEXT | |
| `usage_json` | JSONB | Token usage (input/output/cached) |
| `result_json` | JSONB | |
| `session_id_before` / `session_id_after` | TEXT | CLI session tracking |
| `log_store` / `log_ref` / `log_bytes` / `log_sha256` | | Run log storage |
| `stdout_excerpt` / `stderr_excerpt` | TEXT | |
| `context_snapshot` | JSONB | Issue context, wake reason, task keys |
| `process_pid` / `process_started_at` | | |
| `retry_of_run_id` | UUID FK → heartbeat_runs (self-ref) | |
| `process_loss_retry_count` | INTEGER | Default: 0 |

#### Supporting Tables
- `heartbeat_run_events` — Fine-grained events within a single heartbeat run
- `agent_runtime_state` — Persisted agent runtime state (session IDs) between runs
- `agent_task_sessions` — Per-task session tracking (agent, task_key → session params)
- `agent_wakeup_requests` — Queue of pending wakeup requests

### Cost & Finance Tables

#### `cost_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `company_id` | UUID FK → companies | |
| `agent_id` | UUID FK → agents | |
| `issue_id` | UUID FK → issues | |
| `project_id` | UUID FK → projects | |
| `heartbeat_run_id` | UUID FK → heartbeat_runs | |
| `billing_code` | TEXT | |
| `provider` | TEXT | NOT NULL (e.g. `'anthropic'`, `'openai'`) |
| `biller` | TEXT | Default: `'unknown'` |
| `billing_type` | TEXT | `metered_api`, `subscription_included`, `credits`, etc. |
| `model` | TEXT | NOT NULL |
| `input_tokens` / `cached_input_tokens` / `output_tokens` | INTEGER | |
| `cost_cents` | INTEGER | NOT NULL |
| `occurred_at` | TIMESTAMPTZ | |

> **EXISTING INFRASTRUCTURE**: This table already tracks per-model, per-provider costs. The Master CEO Model Router can log to this table directly.

#### Other Finance Tables
- `finance_events` — Higher-level finance events aggregating cost data
- `budget_policies` — Per-scope (company, project, agent) budget limits with warn thresholds and hard stops
- `budget_incidents` — Records of budget threshold breaches

### Access Control & Auth Tables

- `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` — BetterAuth tables
- `instance_settings` — Global instance configuration
- `instance_user_roles` — User role assignments
- `company_memberships` — User/agent membership in companies
- `principal_permission_grants` — Fine-grained permission grants
- `board_api_keys` — API keys for board access
- `agent_api_keys` — API keys for agent JWT authentication
- `cli_auth_challenges` — CLI authentication flows
- `invites`, `join_requests` — User onboarding

### Skills, Secrets, Plugins

- `company_skills` — Installed skills per company (key, slug, markdown content, source, trust level)
- `company_secrets` / `company_secret_versions` — Encrypted secret storage
- `plugins` — Installed plugin records
- `plugin_config` / `plugin_company_settings` — Plugin configuration
- `plugin_state` — Plugin runtime state
- `plugin_entities` — Plugin-managed entities
- `plugin_jobs` / `plugin_job_runs` — Plugin background jobs
- `plugin_webhooks` — Plugin webhook deliveries
- `plugin_logs` — Plugin execution logs

### Other Tables

- `documents` / `document_revisions` — Rich document storage
- `issue_documents` — Document-issue associations
- `issue_comments` — Comment threads on issues
- `issue_attachments` — File attachments
- `issue_relations` — Issue dependency relationships
- `issue_labels` / `labels` — Label system
- `issue_approvals` — Issue-level approval tracking
- `issue_inbox_archives` — Inbox archival state
- `issue_read_states` — Per-user read tracking
- `issue_work_products` — Work outputs from issues
- `activity_log` — System-wide activity log
- `assets` — Uploaded asset management
- `company_logos` — Company logo storage
- `agent_config_revisions` — Agent configuration change history
- `project_workspaces` — Project workspace definitions
- `project_goals` — Project-goal associations
- `execution_workspaces` — Isolated execution workspace instances
- `workspace_operations` — Workspace lifecycle operations
- `workspace_runtime_services` — Runtime services attached to workspaces
- `approval_comments` / `approvals` — General approval system
- `feedback_votes` / `feedback_exports` — User feedback tracking

---

## 3. API Routes (26 Route Modules)

All routes mounted under `/api` via Express Router in `server/src/app.ts`.

### Companies — `/api/companies`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List companies (filtered by membership) |
| GET | `/stats` | Company-level statistics |
| GET | `/:companyId` | Get single company |
| POST | `/` | Create company (instance admin only) |
| PATCH | `/:companyId` | Update company (CEO agents or board) |
| PATCH | `/:companyId/branding` | Update branding (CEO agents or board) |
| POST | `/:companyId/archive` | Archive company |
| DELETE | `/:companyId` | Delete company (board only) |
| POST | `/:companyId/export` | Export company bundle |
| POST | `/import/preview` | Preview import |
| POST | `/import` | Import company bundle |
| GET | `/:companyId/feedback-traces` | List feedback traces |
| POST | `/:companyId/exports/preview` | Preview export (agent-safe) |
| POST | `/:companyId/exports` | Export (agent-safe) |
| POST | `/:companyId/imports/preview` | Preview import (agent-safe) |
| POST | `/:companyId/imports/apply` | Apply import (agent-safe) |

> **EXTENSION POINT**: `DELETE /:companyId` has no protection against deleting any company. Must add `is_deletable` guard. `POST /` has no `company_type` support.

### Agents — `/api/agents/*` (nested under companies)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/companies/:companyId/agents` | List agents for company |
| GET | `/companies/:companyId/agents/:id` | Get agent detail |
| POST | `/companies/:companyId/agents` | Create agent |
| POST | `/companies/:companyId/agents/hire` | Hire agent (by another agent) |
| PATCH | `/agents/:id` | Update agent |
| DELETE | `/agents/:id` | Delete agent |
| POST | `/agents/:id/wake` | Wake agent (trigger heartbeat) |
| POST | `/agents/:id/pause` | Pause agent |
| POST | `/agents/:id/resume` | Resume agent |
| POST | `/agents/:id/terminate` | Terminate agent |
| GET | `/agents/:id/runs` | List heartbeat runs |
| GET | `/agents/:id/runs/:runId` | Get specific run |
| GET | `/agents/:id/runs/:runId/log` | Stream run log |
| POST | `/agents/:id/keys` | Create agent API key |
| DELETE | `/agents/:id/keys/:keyId` | Delete agent API key |
| GET | `/agents/:id/skills` | List agent skills |
| POST | `/agents/:id/skills/sync` | Sync skills |
| PATCH | `/agents/:id/instructions-path` | Update instructions file path |
| GET | `/companies/:companyId/adapters/:type/models` | List adapter models |
| POST | `/companies/:companyId/adapters/:type/test-environment` | Test adapter environment |
| GET | `/companies/:companyId/org-chart` | Get org chart data |

> **EXTENSION POINT**: `DELETE /agents/:id` has no `is_protected` guard. The `hire` endpoint already exists and creates agents with `reports_to` chain — close to the CEO hire pattern.

### Projects — `/api/companies/:companyId/projects`
CRUD + workspace management for projects.

### Issues — `/api/companies/:companyId/issues`
Full CRUD + status transitions, comments, labels, attachments, documents, work products.

### Routines — `/api/companies/:companyId/routines`
CRUD for routines + triggers + manual/API run dispatching + webhook execution.

### Other Route Modules
| Route | Path Prefix | Purpose |
|-------|-------------|---------|
| `goals` | `/api/companies/:companyId/goals` | Goal hierarchy CRUD |
| `approvals` | `/api/companies/:companyId/approvals` | Approval workflow |
| `costs` | `/api/companies/:companyId/costs` | Cost event queries & charts |
| `activity` | `/api/companies/:companyId/activity` | Activity log |
| `dashboard` | `/api/companies/:companyId/dashboard` | Dashboard widgets |
| `secrets` | `/api/companies/:companyId/secrets` | Encrypted secret management |
| `company-skills` | `/api/companies/:companyId/skills` | Skill installation & sync |
| `execution-workspaces` | `/api/companies/:companyId/execution-workspaces` | Workspace lifecycle |
| `access` | `/api/access/*` | Membership, permissions, invites |
| `plugins` | `/api/plugins/*` | Plugin management |
| `adapters` | `/api/adapters/*` | Adapter listing & control |
| `instance-settings` | `/api/instance/settings` | Instance-level settings |
| `sidebar-badges` | `/api/sidebar/badges` | Sidebar badge counts |
| `llms` | `/api/llms/*` | LLM-related utilities |
| `health` | `/api/health` | Health check + deployment info |
| `assets` | `/api/assets/*` | File upload/download |

---

## 4. Provider / Model System (Adapter Architecture)

### Architecture Overview

Paperclip uses an **adapter pattern** where each AI provider is wrapped in a `ServerAdapterModule`. The system does **NOT** have a "model router" — each agent is statically assigned an adapter type and model.

### Adapter Registry (`server/src/adapters/registry.ts`)

10 built-in adapters registered at startup:

| Adapter Type | Provider | Model Selection | Skills | JWT | Session |
|-------------|----------|----------------|--------|-----|---------|
| `claude_local` | Claude Code CLI | Static list from package | Yes | Yes | Yes |
| `codex_local` | OpenAI Codex CLI | Dynamic `listModels()` | Yes | Yes | Yes |
| `cursor` | Cursor CLI | Dynamic `listModels()` | Yes | Yes | Yes |
| `gemini_local` | Google Gemini CLI | Static list from package | Yes | Yes | Yes |
| `opencode_local` | OpenCode CLI | Dynamic `listModels()` | Yes | Yes | Yes |
| `pi_local` | Pi CLI | Dynamic `listModels()` | Yes | Yes | Yes |
| `hermes_local` | Hermes Agent | Static + `detectModel()` | Yes | Yes | Yes |
| `openclaw_gateway` | OpenClaw Cloud | Static list | No | No | No |
| `process` | Generic process spawner | N/A | No | N/A | N/A |
| `http` | HTTP bridge | N/A | No | N/A | N/A |

### `ServerAdapterModule` Interface
```typescript
interface ServerAdapterModule {
  type: string;                          // Unique adapter identifier
  execute: Function;                     // Run agent task
  testEnvironment?: Function;            // Verify adapter is available
  listSkills?: Function;                 // List available skills
  syncSkills?: Function;                 // Install/sync skills to agent
  sessionCodec?: AdapterSessionCodec;    // Session serialization
  sessionManagement?: Object;            // Session lifecycle
  models: { id: string; label: string }[];  // Static model list
  listModels?: () => Promise<...>;       // Dynamic model discovery
  supportsLocalAgentJwt: boolean;        // Supports local JWT auth
  agentConfigurationDoc?: string;        // Config documentation
  getQuotaWindows?: Function;            // Quota tracking (claude, codex)
  detectModel?: Function;               // Auto-detect active model
}
```

### Current Model Selection Logic

**There is no intelligent model routing.** The current flow is:

1. User creates agent → selects `adapter_type` (e.g., `claude_local`)
2. User selects `model` within adapter config (e.g., `claude-3.5-sonnet`)
3. Agent uses that single adapter + model for ALL tasks
4. No fallback, no cost awareness, no quota tracking across providers

The model is stored in `agents.adapter_config` as:
```json
{ "model": "claude-3.5-sonnet", "instructionsFilePath": "...", ... }
```

### External Adapter Loading

External adapters can be loaded via the plugin system (`buildExternalAdapters()`). They can **override** built-in adapters. Override can be **paused** to restore the built-in fallback.

> **CRITICAL FINDING**: The entire Model Router must be built from scratch. Paperclip has NO concept of:
> - Multi-provider fallback
> - Quota tracking across providers
> - Cost-aware model selection
> - Complexity-based tier routing
> - Dynamic 429 retry with provider switch
> 
> However, the adapter registry architecture is extensible — we can intercept `getServerAdapter()` to inject a routing layer.

---

## 5. Agent Execution System (Heartbeat / Routines)

### Heartbeat System (`server/src/services/heartbeat.ts` — 4,235 lines)

The heartbeat is the **core execution engine**. It manages the lifecycle of agent "runs" — each time an agent wakes up and performs work.

#### Execution Flow

```
Trigger (wake request) → Queue → Start → Execute → Finish
                                    ↓
                              Adapter.execute()
                                    ↓
                           CLI process spawned
                                    ↓
                         stdout/stderr captured
                                    ↓
                          Usage + cost recorded
```

#### Key Mechanisms

1. **Wakeup Sources**: `timer` | `assignment` | `on_demand` | `automation`
2. **Trigger Details**: `manual` | `ping` | `callback` | `system`
3. **Concurrency Control**: Per-agent start locks (`startLocksByAgent` Map). Configurable max concurrent runs (default 1, max 10).
4. **Session Management**: Agents maintain sessions across runs via `agentTaskSessions`. Session IDs track CLI session continuity (e.g., Claude Code conversation context).
5. **Task Key Derivation**: Each run maps to a "task key" (usually an issue ID) to resume the correct session.
6. **Workspace Resolution**: Runs execute in a workspace — agent home, project primary, or isolated execution workspace.
7. **Cost Tracking**: After each run, `costService` records token usage and cost to `cost_events`.
8. **Budget Enforcement**: Before execution, `budgetService` checks agent/company budget limits. Hard stops prevent execution when budget is exhausted.
9. **Session Compaction**: Long-running sessions can be compacted (rotated) to manage context window limits.

#### Heartbeat Scheduler (`server/src/index.ts`)

```typescript
// Configured in config.ts:
heartbeatSchedulerEnabled: true,          // ENV: HEARTBEAT_SCHEDULER_ENABLED
heartbeatSchedulerIntervalMs: 30000,      // ENV: HEARTBEAT_SCHEDULER_INTERVAL_MS (min 10s)
```

The scheduler runs on a `setInterval` loop:
1. Check all agents with `runtimeConfig.heartbeat.enabled = true`
2. Check if `heartbeat.intervalSec` has elapsed since `last_heartbeat_at`
3. If due → create wakeup request with source `timer`
4. Process pending wakeup requests → start heartbeat runs

### Routine System (`server/src/services/routines.ts` — 1,482 lines)

Routines are **scheduled, recurring tasks** that automatically create issues for agents.

#### Routine Execution Flow

```
Cron Trigger → Routine Fires → Issue Created → Agent Woken → Agent Executes
                                    ↓
                          Concurrency Check
                          (skip/coalesce/always_enqueue)
```

#### Key Features

1. **Cron Scheduling** (`services/cron.ts`): Full 5-field cron parser with timezone support
2. **Triggers**: `schedule` (cron), `webhook` (HTTP), `manual`, `api`
3. **Variables**: Typed variables (text, number, boolean, select) with template interpolation
4. **Concurrency Policies**:
   - `coalesce_if_active` — Merge into existing active issue
   - `skip_if_active` — Skip if issue already running
   - `always_enqueue` — Always create new issue
5. **Catch-up Policy**: `skip_missed` — Don't run backlogged cron ticks
6. **Webhook Auth**: HMAC signing with dedicated secrets

> **EXISTING INFRASTRUCTURE**: The routine system is directly usable for CEO agent daily tasks (e.g., Cost Research Agent at 04:00, Intelligence Agent at 03:00). We just need to create routines with appropriate cron expressions and assign them to our agents.

---

## 6. UI Component Structure (React Tree)

### Root (`ui/src/App.tsx`)

```
<App>
  <Routes>
    ├── /auth → <AuthPage />
    ├── /board-claim/:token → <BoardClaimPage />
    ├── /cli-auth/:id → <CliAuthPage />
    ├── /invite/:token → <InviteLandingPage />
    │
    └── <CloudAccessGate>  (auth check wrapper)
        ├── / → <CompanyRootRedirect />
        ├── /onboarding → <OnboardingRoutePage />
        │
        ├── /instance/settings/ → <Layout> (no company sidebar)
        │   ├── general → <InstanceGeneralSettings />
        │   ├── heartbeats → <InstanceSettings />
        │   ├── experimental → <InstanceExperimentalSettings />
        │   ├── plugins → <PluginManager />
        │   ├── plugins/:pluginId → <PluginSettings />
        │   └── adapters → <AdapterManager />
        │
        └── /:companyPrefix/ → <Layout>  (with company sidebar)
            ├── dashboard → <Dashboard />
            ├── companies → <Companies />
            ├── company/settings → <CompanySettings />
            ├── company/export → <CompanyExport />
            ├── company/import → <CompanyImport />
            ├── skills/* → <CompanySkills />
            ├── org → <OrgChart />
            │
            ├── agents/all → <Agents />
            ├── agents/new → <NewAgent />
            ├── agents/:agentId → <AgentDetail />
            │   └── tabs: overview, runs, configuration, skills
            │
            ├── projects → <Projects />
            ├── projects/:projectId → <ProjectDetail />
            │   └── tabs: overview, issues, workspaces, configuration, budget
            │
            ├── issues → <Issues />
            ├── issues/:issueId → <IssueDetail />
            │
            ├── routines → <Routines />
            ├── routines/:routineId → <RoutineDetail />
            │
            ├── goals → <Goals />
            ├── goals/:goalId → <GoalDetail />
            │
            ├── approvals → <Approvals />
            ├── costs → <Costs />
            ├── activity → <Activity />
            ├── inbox → <Inbox />
            │
            └── execution-workspaces/:id → <ExecutionWorkspaceDetail />

  <OnboardingWizard />  (global modal, always mounted)
```

### Layout Components

```
<Layout>
  ├── <CompanyRail />              # Left sidebar - company list (icons)
  ├── <Sidebar>                    # Main navigation sidebar
  │   ├── <CompanySwitcher />      # Company name + dropdown
  │   ├── <SidebarNavItem />       # Dashboard, Inbox, Issues, etc.
  │   ├── <SidebarAgents />        # Agent list with status dots
  │   ├── <SidebarProjects />      # Project list
  │   └── <InstanceSidebar />      # Settings, Plugins links
  ├── <BreadcrumbBar />            # Top breadcrumb navigation
  ├── <MobileBottomNav />          # Mobile bottom tab bar
  ├── <DevRestartBanner />         # Dev mode restart notification
  └── <Outlet />                   # Page content
```

### Key Components (98 files in `ui/src/components/`)

| Component | Size | Purpose |
|-----------|------|---------|
| `OnboardingWizard.tsx` | 56KB | Company creation + agent setup wizard |
| `AgentConfigForm.tsx` | 67KB | Agent adapter/model configuration |
| `NewIssueDialog.tsx` | 61KB | Issue creation form |
| `IssueDocumentsSection.tsx` | 51KB | Issue documents panel |
| `ProjectProperties.tsx` | 46KB | Project settings panel |
| `IssuesList.tsx` | 43KB | Issue list with filtering |
| `CommentThread.tsx` | 32KB | Issue comment system |
| `MarkdownEditor.tsx` | 30KB | Markdown editor |
| `JsonSchemaForm.tsx` | 29KB | Dynamic JSON schema forms |
| `CompanyRail.tsx` | 12KB | Company icon sidebar |
| `ProviderQuotaCard.tsx` | 18KB | Provider quota visualization |
| `QuotaBar.tsx` | 2KB | Quota progress bar |
| `ScheduleEditor.tsx` | 12KB | Cron schedule editor |
| `KanbanBoard.tsx` | 8KB | Kanban view for issues |
| `CommandPalette.tsx` | 8KB | Cmd+K command palette |

### UI Tech Stack
- **Router**: React Router v6
- **State**: React Query (TanStack Query) for server state
- **UI Primitives**: Radix UI (shadcn/ui pattern)
- **Styling**: Tailwind CSS + CSS custom properties
- **Build**: Vite

> **UI EXTENSION POINTS**:
> - `OnboardingWizard.tsx` — extend for hardware detection + model download steps
> - `CompanyRail.tsx` / `Sidebar.tsx` — add crown icon for master company
> - `ProviderQuotaCard.tsx` / `QuotaBar.tsx` already exist — leverage for Cost Dashboard
> - `Costs.tsx` page (50KB) already shows cost charts — extend with multi-provider quota view
> - `AgentConfigForm.tsx` — add model_preference override UI
> - `CompanySettings.tsx` — add deletion protection indicators

---

## 7. Configuration & Environment

### Config Loading (`server/src/config.ts`)

Config is loaded from two sources:
1. `.env` file at `~/.paperclip/.env`
2. YAML config file at `~/.paperclip/config.yaml`

Key configuration:

| Config | Default | ENV Override |
|--------|---------|------------|
| `port` | 3100 | `PORT` |
| `host` | 127.0.0.1 | `HOST` |
| `deploymentMode` | `local_trusted` | `PAPERCLIP_DEPLOYMENT_MODE` |
| `databaseMode` | `embedded-postgres` | (config file) |
| `heartbeatSchedulerEnabled` | true | `HEARTBEAT_SCHEDULER_ENABLED` |
| `heartbeatSchedulerIntervalMs` | 30000 | `HEARTBEAT_SCHEDULER_INTERVAL_MS` |
| `secretsProvider` | `local_encrypted` | `PAPERCLIP_SECRETS_PROVIDER` |
| `storageProvider` | `local_disk` | `PAPERCLIP_STORAGE_PROVIDER` |
| `companyDeletionEnabled` | true (local mode) | `PAPERCLIP_ENABLE_COMPANY_DELETION` |

---

## 8. Extension Points Summary for Master CEO

### Ready to Use (Minimal Changes)

| Feature | Existing Support | Where |
|---------|-----------------|-------|
| Agent `role: 'ceo'` | Already recognized in auth checks | `routes/agents.ts`, `routes/companies.ts` |
| Agent `reports_to` hierarchy | Self-referencing FK works | `schema/agents.ts` |
| Agent `permissions.canCreateAgents` | Agents can already hire others | `routes/agents.ts` — hire endpoint |
| Routines with cron | Full cron scheduling system | `services/routines.ts`, `services/cron.ts` |
| Cost tracking per model | `cost_events` table records all costs | `services/costs.ts` |
| Budget policies with hard stops | Company/project/agent budgets | `services/budgets.ts` |
| Company skills installation | Skill install/sync implemented | `services/company-skills.ts` |
| Company secrets (encrypted) | AES-encrypted secret storage | `services/secrets.ts` |
| Agent wakeup system | Timer/assignment/on-demand/automation | `services/heartbeat.ts` |

### Requires New DB Tables

| Table | Purpose |
|-------|---------|
| `api_keys` | BYOK key storage (AES-256 encrypted) |
| `provider_registry` | Free/paid model catalog with capabilities |
| `quota_tracker` | Real-time quota tracking across providers |

### Requires Column Extensions

| Table | New Columns |
|-------|-------------|
| `companies` | `company_type`, `is_deletable`, `parent_company_id` |
| `agents` | `is_protected`, `hired_by`, `skills`, `kb_access`, `model_preference` |

### Requires New Services

| Service | Purpose |
|---------|---------|
| `ModelRouter` | 7-tier cost-aware model selection (completely new) |
| `ProviderRegistry` | Model catalog management |
| `QuotaTracker` | Cross-provider quota tracking |
| `OllamaProvider` | Local model integration via Ollama API |
| `KBFileManager` | Knowledge Base file system layer |
| `KBIndexer` | SQLite + sqlite-vec embedding & indexing |
| `KBSearcher` | Semantic search with scope filtering |
| `IntelligenceAgent` | Web scraping + summarization |

### Requires UI Additions

| Page/Component | Purpose |
|----------------|---------|
| API Keys settings page | BYOK key management for 9 providers |
| Cost Dashboard enhancements | Multi-provider quota bars, tier indicator |
| Knowledge Base browser | File tree + semantic search |
| Master Company indicators | Crown icons, protection badges, always-first sorting |
| Onboarding extensions | Hardware detection, Gemma 4 model download progress |

---

## 9. Migration Pattern

Migrations use **Drizzle Kit** with sequential numbering:
```
packages/db/src/migrations/
├── 0000_mature_masked_marvel.sql    # Initial schema (14KB)
├── 0001_fast_northstar.sql          # Early additions
├── ...
└── 0049_flawless_abomination.sql    # Latest migration
```

New migrations should follow the pattern: `0050_descriptive_name.sql`.

Migration runner: `packages/db/src/migrate.ts` using `drizzle-orm/migrator`.

---

*Document created: 2026-04-06 | Phase 1 (Codebase Understanding) | Zero code changes*

## 2026-04-08 Delta Snapshot (Current As-Built)

### New/updated implementation points
- `paperclip/server/src/services/master-company.ts`
  - Master hierarchy seed expanded to 4 protected master agents:
    - Master CEO
    - Cost & Provider Research Agent
    - Model Research Router Agent
    - AI News and Releases Agent
  - protected master agents standardized with `canCreateAgents: true`
  - default managed instruction bundles and routines seeded for protected agents
- `paperclip/server/src/routes/agents.ts`
  - create/hire flow enforces `canCreateAgents: true` defaults for `company_type = master`
  - new-agent default instruction materialization includes:
    - `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`, `SKILLS.md`
  - explicit adapter selection UX hardening support (paired with UI updates)
- `paperclip/server/src/services/provider-discovery.ts` + related routes
  - discovery crawl/parser/extraction pipeline
  - confidence scoring and evidence-backed suggestions
  - publish validation gate and validated metadata write path
- `paperclip/ui/src/pages/InstanceSettings.tsx` and API-key settings surfaces
  - Provider Discovery Suggestions UX (discover/refresh/filter/publish, evidence/confidence display)
- `paperclip/ui/src/components/agent-config-defaults.ts`, `NewAgent.tsx`, `OnboardingWizard.tsx`,
  `InviteLanding.tsx`, `CompanyImport.tsx`, `AgentConfigForm.tsx`
  - implicit `claude_local` fallback removed
  - adapter type must be chosen explicitly in creation/join/import flows
- `paperclip/server/src/services/agents.ts`
  - org tree builder preserves local roots when `reportsTo` points to cross-company manager (master)
- `paperclip/server/src/services/issues.ts`, `paperclip/server/src/services/routines.ts`
  - pending-approval assignment errors made actionable ("approve pending hire first")

### Validation snapshot
- Provider discovery and API-key settings tests: passing
- Master-company seed tests: passing
- Org reporting regression test (`agent-master-reports-to.test.ts`): passing
- Server/UI typecheck: passing

---

## 2026-04-09 Delta Snapshot (Phase 4 + Hardening)

### New backend modules
- `paperclip/server/src/services/knowledge-base/`
  - `file-manager.ts`
  - `indexer.ts`
  - `searcher.ts`
  - `embeddings.ts`
  - `access.ts`
  - `scopes.ts`
  - `runtime.ts`
  - `policy-audit.ts`
- `paperclip/server/src/routes/knowledge-base.ts`

### New/expanded backend tests
- `paperclip/server/src/__tests__/knowledge-base-service.test.ts`
- `paperclip/server/src/__tests__/knowledge-base-policy-audit.test.ts`
- `paperclip/server/src/__tests__/knowledge-base-routes.test.ts`

### New UI surface
- `paperclip/ui/src/pages/KnowledgeBase.tsx`
- `paperclip/ui/src/api/knowledgeBase.ts`
- Sidebar + app routing updated for `/knowledge-base`.

### i18n baseline standardization (UI)
- `paperclip/ui/src/context/I18nContext.tsx`
- `paperclip/ui/src/i18n/messages.ts`
- `paperclip/ui/src/lib/i18n.ts`
- `paperclip/ui/src/lib/i18n.test.ts`

### Benchmark/report artifact
- `paperclip/report/2026-04-09-kb-sqlite-vec-benchmark.md`
