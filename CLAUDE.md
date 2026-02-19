# Assembly Lime — Software Factory POC

## Project Overview

Assembly Lime is a multi-tenant software factory dashboard where PM/Dev/QA collaborate on planning and execution with AI agents (Claude Agent SDK), connected to an org's GitHub repositories and deployment pipelines via Daytona sandboxes.

**Core UX surfaces:**
- **Command Center** — Chat-first prompt interface with model/provider selector, streaming transcript, artifact viewer (diffs, PR links, test output)
- **Kanban Board** — Jira-like columns: `Backlog > Todo > In Progress > Code Review > QA > Done` with drag/drop, ticket drawers
- **GitHub integration** — Repo connections via GitHub App (App ID: 2899278), PR status, GitHub Actions workflow visibility
- **AI Agents** — Modes: `plan`, `implement`, `bugfix`, `review`. Outputs: ticket plans + diffs + PRs, all auditable
- **Feature Map** — Searchable feature-to-repository mapping so agents auto-plan changes across all affected repos

## Tech Stack

- **Runtime:** Bun (api, worker-agent); Node 24 via nvm (web/Vite)
- **Language:** TypeScript everywhere
- **API framework:** Elysia (Bun-native)
- **Frontend:** React + Vite + Tailwind + Radix UI, drag/drop via `@dnd-kit`
- **Database:** PostgreSQL 16 via Drizzle ORM (hosted on DigitalOcean managed DB)
- **Queue:** Trigger.dev v3 (managed cloud queue with retries, concurrency, dashboard)
- **Auth:** GitHub OAuth + PostgreSQL session cookies + GitHub App (installation tokens)
- **Realtime:** WebSocket (Bun-native) + HTTP POST callbacks (workers → API)
- **Sandboxes:** Daytona SDK (cloud sandboxes for agent code execution)
- **Logging:** pino with request IDs and run IDs

## Actual Monorepo Layout

```
assembly-lime/
  apps/
    api/                  # Bun + Elysia API server (port 3434)
    web/                  # React + Vite frontend (port 5173)
    worker-agent/         # Unified agent worker (Claude Agent SDK + Daytona sandboxes)
    worker-claude/        # Legacy Claude worker (deprecated, use worker-agent)
    worker-codex/         # Legacy Codex worker (deprecated)
    trigger/              # Trigger.dev task definitions
      claude-agent.ts     # Main agent task (dispatches to worker-agent)
      agent-task.ts       # Sub-task execution
      dep-scan.ts         # Dependency scanning task
      codex-agent.ts      # Legacy codex task
  packages/
    shared/               # Types, Zod schemas, event protocol, DB client
      src/
        protocol.ts       # AgentEvent, AgentJobPayload, provider types
        github-app.ts     # GitHub App JWT + installation token generation
        daytona-workspace.ts  # Daytona SDK wrapper (sandbox + git ops)
        change-extractor.ts   # Diff/change parsing utilities
        index.ts          # Re-exports all shared modules
        db/
          client.ts       # Drizzle DB client
          schema/         # All Drizzle table definitions (20+ files)
        prompts/          # Agent system prompt templates
```

## Key Architecture Patterns

### GitHub App Authentication (Current)
Agent workers generate fresh GitHub App installation tokens worker-side before cloning:
1. `isGitHubAppConfigured()` checks env vars (`GITHUB_APP_ID` + private key)
2. `generateInstallationToken(repoOwner)` creates JWT, looks up installation ID, generates 1-hour token
3. Token used for clone, push, and PR creation
4. Token refreshed before push if <10 min remaining
5. Falls back to connector OAuth token if GitHub App not configured

**Key file:** `packages/shared/src/github-app.ts`

### Daytona Sandbox Lifecycle
1. `DaytonaWorkspace.createSandbox(opts)` — creates sandbox (no clone)
2. `workspace.cloneRepo(opts)` — clones repo with auth credentials
3. `workspace.createBranch(name)` — creates working branch (`al/{mode}/{runId}`)
4. Agent runs tools inside sandbox via `workspace.exec()`
5. `workspace.stageAll()` + `workspace.commit()` + `workspace.push()` — post-run
6. `workspace.setAuthCredentials()` — update credentials for token refresh

**Key file:** `packages/shared/src/daytona-workspace.ts`

### Unified Agent Worker
Single worker (`apps/worker-agent/`) handles all agent modes. Flow in `src/run.ts`:
1. Resolve repo (LLM selection if multiple candidates)
2. Generate GitHub App installation token (or fallback to connector token)
3. Create Daytona sandbox → clone repo → create working branch
4. Build tools based on mode (`src/tools/index.ts`)
5. Build system prompt (`src/agent/system-prompt.ts`)
6. Create agent via factory (`src/agent/factory.ts`)
7. Bridge events to API via emitter (`src/agent/emitter.ts`)
8. Run agent prompt with max-turns safety (50 turns)
9. Post-run: auto-commit, push, emit diffs
10. Preview: start dev server in sandbox
11. Emit `awaiting_approval` for human-in-the-loop

### Internal Event Pipeline
Worker → API communication via HTTP POST with `x-internal-key` auth:
- `POST /internal/agent-events/:runId` — persists AgentEvent, updates run status, broadcasts via WS
- `POST /internal/llm-call-dumps/:runId` — stores LLM call details (tokens, cost, model)
- `POST /internal/agent-run-repos/:runId` — tracks repo/branch per run (upsert)
- `POST /internal/code-diffs/:runId` — stores unified diffs
- `POST /internal/agent-tasks/:runId` — creates tickets from agent-planned tasks

**Key files:** `apps/api/src/routes/internal-events.ts`, `apps/worker-agent/src/agent/emitter.ts`

### Agent Tools
Tools available per mode, defined in `apps/worker-agent/src/tools/`:
- `git.ts` — git operations (stage, commit, diff, log)
- `create-pr.ts` — GitHub PR creation via API
- `create-tasks.ts` — create sub-tickets via internal API
- `subagent.ts` — spawn sub-agents for parallel work
- `index.ts` — tool registry and mode-based filtering

## Tooling Conventions

- **Always use `bun` CLI for scaffolding** — use `bun init`, `bun create`, `bun add` instead of npm/yarn/pnpm equivalents
- **Bun workspaces** for monorepo management (configured via root `package.json` `workspaces` field)
- **`bun create vite`** for new frontend apps (React + Vite)
- **`bun init`** for new backend apps and packages
- **`bun add`** for installing dependencies (`bun add -d` for devDependencies)

## Critical Rules

### Database Conventions (REQUIRED)
- **Primary keys:** `BIGINT GENERATED BY DEFAULT AS IDENTITY` — NO UUIDs anywhere
- **All timestamps:** `timestamptz`
- **Multi-tenant:** Every row is tenant-scoped via `tenant_id` FK
- **Extensions:** `citext` (emails), `pgcrypto` (hash/random), `pg_trgm` (fuzzy search)
- **Deletion:** `ON DELETE CASCADE` for tightly owned records; soft delete for sensitive entities (connectors, api_keys)
- **IDs over the wire:** All bigint IDs serialized as **strings** in API/WS JSON payloads (JS BigInt is not JSON-serializable)

### Security (REQUIRED)
- Never store secrets in DB unencrypted — use envelope encryption (libsodium + `ENCRYPTION_MASTER_KEY` env var)
- Never execute user hooks outside a sandbox container (no host FS, no network by default)
- Never send secrets to agents in plain text
- Never log secrets
- Agent workers run in Daytona sandboxes with limited FS and network access
- All API inputs validated with Zod

### Agent Protocol
- Every worker must emit structured `AgentEvent`s (message, log, diff, artifact, error, status, tasks, sandbox)
- API persists all events into `agent_events` table
- Events broadcast to UI via WebSocket
- Agent: enforce `allowedTools` per run mode
- Max 50 turns per run with graceful wind-down

## Data Model (DRM Entities)

All tenant-scoped. Schema files in `packages/shared/src/db/schema/`.

**Core:** tenants, users, roles, user_roles
**Projects:** projects, boards, tickets
**Connectors:** connectors, repositories, webhooks
**Features (v3):** features, feature_repository_map, feature_aliases, repository_aliases, project_repositories
**Agent:** agent_runs, agent_events, agent_run_repos, code_diffs, llm_call_dumps, audit_log
**Auth:** sessions
**Config:** hooks, custom_instructions, default_agent_instructions, default_agent_tools, tool_definitions
**Infra:** build_pipelines, pipeline_runs, deployment_targets, deployments, deployment_steps
**Security:** api_keys, env_var_sets, env_vars, project_budgets
**Images:** images (container image registry)
**Preview:** preview_deployments

## Provider Abstraction

Shared types live in `packages/shared/src/protocol.ts`:
- `AgentProviderId`: `"codex" | "claude"`
- `AgentMode`: `"plan" | "implement" | "bugfix" | "review"`
- `AgentRunRequest`: run config with repo info, constraints, ticket context
- `AgentEvent`: union type for message/log/diff/artifact/error/status/tasks/sandbox events

## Agent Data Flow

1. UI requests agent run: `POST /agent-runs`
2. API creates `agent_runs` row, resolves instructions + repos, dispatches via Trigger.dev
3. Trigger.dev task (`apps/trigger/claude-agent.ts`) calls `runUnifiedAgent(payload)`
4. Worker generates GitHub App token, creates Daytona sandbox, clones repo
5. Agent runs with tools, emits streaming events via `POST /internal/agent-events/:runId`
6. API persists events + broadcasts to UI via WebSocket
7. Post-run: auto-commit, push, emit diffs, start preview
8. Emit `awaiting_approval` — user reviews changes before PR creation

**No Redis dependency.** Queue dispatch uses Trigger.dev v3 (managed cloud). Worker-to-API event streaming uses HTTP POST with `x-internal-key` auth. Sessions stored in PostgreSQL `sessions` table.

## Instruction Resolution Order

When building the system prompt for an agent run:
1. `default_agent_instructions` (tenant + provider)
2. `custom_instructions` for tenant scope
3. `custom_instructions` for project scope
4. `custom_instructions` for repository scope
5. `custom_instructions` for ticket scope
6. User prompt

## Feature Map (v3 — Multi-Repo Planning)

When a user requests "create/update feature X", the planning agent must:
1. Search `features.search_text` + `feature_aliases` for the feature
2. Retrieve mapped repositories from `feature_repository_map`
3. Produce a plan grouped by repository (backend/frontend/SDK/pipeline)
4. Include deployment work if pipeline_repo or infra repos are mapped
5. Include version bump matrix for SDK/package repos if touched

Fallback when feature not found: use `project_repositories` and match repo roles to keywords in the prompt.

## Current State (as of 2026-02-19)

### Completed
- **Milestones A-E** — Schema, auth, boards, connectors, agent runs all functional
- **Unified agent worker** — Single worker handles plan/implement/bugfix/review modes
- **GitHub App authentication** — Worker-side token generation replaces fragile connector token pipeline
- **Daytona sandbox integration** — Full lifecycle: create → clone → branch → execute → commit → push
- **Internal event pipeline** — All 5 endpoints working (agent-events, llm-call-dumps, agent-run-repos, code-diffs, agent-tasks)
- **Multi-repo support** — LLM-based repo selection, additional repo cloning for implement/bugfix
- **Agent tools** — git ops, PR creation, task creation, sub-agent spawning
- **Preview deployments** — Dev server in sandbox with preview URL
- **Human-in-the-loop** — `awaiting_approval` status for plan review and PR approval

### Known Issues / Action Items
- **GitHub App installation** — Must be installed on the target GitHub org (e.g., `roid-software`) via GitHub settings. Without installation, token generation fails with clear error message.
- **LLM call dumps** — `postInternal` was previously fire-and-forget; now logs warnings on failure. Verify dumps are being stored after API restart.
- **Agent task creation** — Requires `projectId` on the agent run. Runs without a project will get a 400 error. Ensure runs are always dispatched with a project context.

## Next Stages

### Stage 1: Stabilization & Observability
- [ ] Verify end-to-end agent run flow after GitHub App installation on target org
- [ ] Confirm LLM call dumps are persisted (check `llm_call_dumps` table)
- [ ] Add cost tracking dashboard (aggregate `costCents` from `llm_call_dumps`)
- [ ] Add agent run history/replay in UI (timeline of events)

### Stage 2: PR Creation & Review Loop
- [ ] Implement approval → PR creation flow (user approves `awaiting_approval` → agent creates PR)
- [ ] PR review mode: agent reviews PRs, posts comments, suggests changes
- [ ] Link created PRs back to tickets (update ticket status to `Code Review`)

### Stage 3: Multi-Repo Orchestration
- [ ] Coordinate changes across multiple repos in a single agent run
- [ ] Dependency-aware ordering (shared lib changes before consumers)
- [ ] Cross-repo PR creation with linked descriptions

### Stage 4: Deployment Pipeline Integration
- [ ] Build pipeline tracking (GitHub Actions → `pipeline_runs` table)
- [ ] Deployment targets and deployment steps
- [ ] Agent-triggered deployments after PR merge

### Stage 5: Advanced Features
- [ ] Budget enforcement (`project_budgets` table, per-run cost limits)
- [ ] Custom hooks (instruction resolution engine, hook sandbox execution)
- [ ] Feature map v3 (auto-detect affected repos from feature description)
- [ ] Agent memory/context persistence across runs

## Environment Variables

```
DATABASE_URL=postgres://...
API_BASE_URL=http://localhost:3434
INTERNAL_AGENT_API_KEY=...           # openssl rand -hex 32
TRIGGER_SECRET_KEY=...               # from Trigger.dev dashboard → API Keys
GITHUB_CLIENT_ID=...                 # GitHub OAuth App
GITHUB_CLIENT_SECRET=...
GITHUB_APP_ID=...                    # GitHub App (for installation tokens)
GITHUB_APP_PRIVATE_KEY_PATH=...      # Path to PEM file (or use GITHUB_APP_PRIVATE_KEY for inline)
GITHUB_APP_INSTALLATION_ID=...       # Optional — auto-detected from repo owner
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
ENCRYPTION_MASTER_KEY=...            # openssl rand -hex 32
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=...
TRIGGER_ACCESS_TOKEN_GHCR=...        # For Trigger.dev GHCR image pulls
```

## Development

The app is called **assemblyLime**. The user runs all services themselves — do NOT attempt to start, stop, restart, or check running processes. Do NOT run `bun dev`, `bun dev:all`, `lsof`, `ps`, or any process inspection commands. Assume the API, web frontend, and workers are already running when the user is testing.

```bash
bun install          # Install dependencies
bun db:push          # Apply schema changes (db:migrate has permission issues on managed DB)
bun db:seed          # Seed dev data
```

**Running locally (two terminals):**

```bash
# Terminal 1: API + web + workers
bun dev:all

# Terminal 2: Trigger.dev local dev worker (processes agent runs + dep scans)
bun trigger:dev
```

`bun dev:all` starts the API, web frontend, and workers. Trigger.dev must run separately — it connects to the Trigger.dev cloud, pulls dispatched tasks, and executes them locally.

**Ports:**
- `3434` — API (Bun + Elysia)
- `5173` — Frontend (Vite dev server, proxies `/api` → `:3434`)

## Reference Documents

- `assembly-lime-poc-plan.md` — Original POC plan (architecture, UI spec, agent prompts, milestone sequence)
- `assembly-lime-poc-plan-v2.md` — Full Postgres-optimized DRM schema, API routes, provider abstraction
- `assembly-lime-poc-plan-v3.md` — Multi-repo projects, feature map, deployments, search optimization
