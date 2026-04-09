# Phase 4.5 Bridge Plan (Between Phase 4 and Phase 5)
Date: 2026-04-09  
Status: Proposed execution phase before Phase 5

## Why This Bridge Phase Exists
This phase resolves strategic alignment gaps discovered after Phase 4 completion:
- Model Router must be advisory, not a deterministic strategic gate.
- Master CEO must be final authority on model/provider selection.
- File handling must support practical enterprise usage (larger files, broader formats, upload/download clarity).

This phase is intentionally placed between Phase 4 and Phase 5.

---

## 1) Governance Shift: Remove Deterministic Strategic Enforcer

### Target operating model
1. Model Router = recommendation engine.
2. Master CEO = final decision authority.
3. Runtime checks remain technical/feasibility only (not strategic policy override blockers).

### What changes
- Remove "policy-valid recommendation only" behavior for strategic choice.
- Keep only feasibility checks:
  - provider/model reachable
  - required credentials exist
  - quota/balance/availability status
- If a chosen model is not feasible, return warnings + alternatives; do not block strategic override logic globally.

### Required implementation
- Routing decision contract update:
  - `suggested_model`, `alternatives`, `table_columns`, `rationale`
  - `selected_model` (set by Master CEO)
  - `final_decision_by = "master_ceo"`
- Override API path:
  - `POST /api/settings/router-agent/override` (or equivalent service endpoint)
- Decision trace persistence:
  - record suggested vs selected for future router learning.

### Acceptance criteria
- Master CEO can select a model/provider outside router top recommendation.
- System executes if technically feasible.
- If infeasible, system returns structured reason and alternatives.

---

## 2) Router Report/Table Expansion Requirements

### Mandatory report characteristics
- Router output must be comprehensive and structured.
- Master CEO can request additional columns dynamically.

### Minimum default columns
- provider
- model_id
- task_fit_score
- input_modality support
- output_modality support
- vision support
- image_generation support
- tool/function support
- context_window
- input_cost_per_1m
- output_cost_per_1m
- expected_latency_band
- benchmark_notes
- availability/quota state
- platform/runtime notes
- confidence

### Dynamic expansion
- Add request path: `expand_columns[]`.
- Router must re-render same candidate set with new columns if requested.

### Knowledge Base persistence (mandatory)
- Every router decision table/report is saved in KB under Master scope.
- Recommended path pattern:
  - `KnowledgeBase/Global_Holding/wiki/router_decisions/YYYY/MM/<task-id>-<slug>.md`
- Each report file includes creator/owner metadata (frontmatter).

---

## 3) Knowledge Base Authoring Traceability Rules

### File metadata standard (frontmatter)
Each generated report/wiki file must include:
- `created_by_agent_id`
- `created_by_agent_name`
- `requested_by`
- `company_scope`
- `task_id`
- `created_at`
- `updated_at`
- `selected_model`
- `suggested_model`

### Discoverability standard
- Maintain index file:
  - `Global_Holding/wiki/router_decisions/index.md`
- Append one-line entry per report:
  - timestamp, creator, short title, file path.

### Audit standard
- KB write/edit/move/delete actions must emit activity log events with actor identity.

---

## 4) File Upload/Download Expansion Plan

### Current pain points to fix
- 10 MB limit is too small.
- Video/audio and office format flows are not practical by default.
- Download flow must be first-class for uploaded artifacts.

### Target behavior
1. Default max attachment size: **100 MB**.
2. Upload/download enabled for common business + media formats.
3. Images/audio/video should not be overly constrained by extension-level micromanagement.

### Proposed content-type policy
- Allow broad classes:
  - `image/*`
  - `audio/*`
  - `video/*`
  - `application/pdf`
  - `text/*`
  - `application/json`
  - `text/csv`
  - `application/vnd.ms-excel`
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`)
  - `application/vnd.ms-excel.sheet.macroenabled.12` (`.xlsm`)
  - `application/msword` (`.doc`)
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`)
- Keep env override support (`PAPERCLIP_ALLOWED_ATTACHMENT_TYPES`) for ops tuning.

### Proposed size policy
- Default:
  - `PAPERCLIP_ATTACHMENT_MAX_BYTES=104857600` (100 MB)
- Optional per-instance overrides for stricter/larger deployments.

### UX requirements
- Issue/New Issue upload picker accepts expanded types.
- Attachment list clearly shows:
  - filename, type, size, uploader, uploaded_at
- Download action available per attachment.
- Media preview behavior:
  - images inline preview
  - audio/video: playable if browser supports; otherwise download link fallback.

### Security safeguards
- Keep MIME validation + wildcard matching.
- Keep company access controls.
- Keep storage-level access checks for download endpoints.
- Optional future: virus scanning hook before finalize.

---

## 5) Scope of Work (Implementation Sequence)

1. Router governance contract refactor (advisor-only model).
2. Master CEO override path + decision trace persistence.
3. Router table schema + dynamic column expansion.
4. KB report persistence standard (path + frontmatter + index updates).
5. Attachment policy upgrade:
   - max size 100 MB
   - expanded MIME allowlist
   - UI accept filters and download affordances.
6. Test hardening and regression pass.

---

## 6) Test Plan for Phase 4.5

### Router governance tests
- Master CEO override outside top recommendation succeeds when feasible.
- Infeasible override returns structured warning + alternatives.
- Suggested vs selected decision trace persists correctly.

### KB persistence tests
- Router report file is created in expected folder pattern.
- Frontmatter includes creator + decision metadata.
- Index file entry is appended correctly.

### Upload/download tests
- 100 MB boundary behavior:
  - 100 MB accepted
  - >100 MB rejected with clear message
- `audio/*`, `video/*`, `image/*` accepted.
- `pdf/csv/json/md/xlsx/xlsm/doc/docx` accepted.
- Download endpoint returns correct content headers and file.

---

## 7) Phase Exit Criteria (Must Pass Before Phase 5)

1. No deterministic strategic gate remains over Master CEO model choice.
2. Router operates as recommendation/table engine with expandable columns.
3. Router reports are persisted in KB with creator traceability.
4. Upload/download supports practical formats and 100 MB default cap.
5. All related server/UI tests and typechecks pass.

---

## 8) Practical Notes

- This bridge phase does not remove technical safety checks; it removes strategic rigidity.
- If needed, a stricter policy mode can remain as optional instance config, but default behavior should match Master CEO authority.
- This phase is a prerequisite for a healthy Phase 5 (Hermes CEO autonomy) rollout.

