# Repository Guidelines

## Project Structure & Module Organization
- apps/: runtime apps
  - apps/api: Bun + Elysia API (`src/routes`, `src/services`, Drizzle in `drizzle/`)
  - apps/web: React + Vite UI (`src/components`, `src/pages`)
  - apps/worker-claude, apps/worker-codex: queue workers (BullMQ)
- packages/shared: shared types, DB schema, prompts (`src/db/schema/*`, `src/protocol.ts`)
- infra: infra configs (Docker/K8s stubs; not required for local dev)
- docs: security and operations docs

## Capabilities & Features
- Command Center agents (Claude/Codex) with modes `plan | implement | bugfix | review`, streaming transcripts, diffs, and artifacts (`apps/web/src/pages/CommandCenterPage.tsx`; API `routes/agent-runs.ts`, WS `routes/ws.ts`).
- Tickets + Kanban with drag/drop and drawers (`apps/web/src/pages/BoardPage.tsx`; API `routes/tickets.ts`).
- GitHub connectors, repo lists, and dependency graph views (`ConnectorsPage.tsx`, `ReposPage.tsx`, `RepoDependencyGraphPage.tsx`; API `routes/connectors.ts`, `repositories.ts`, `repository-dependencies.ts`).
- Queues + observability: BullMQ for agent runs, dashboard at `/bull-board`, real-time events over WebSocket.
- K8s sandboxes + previews: Drizzle K8s model and configs drive per-run sandboxes where the agent clones repos, applies changes, builds previews, iterates until approved, then raises a PR (`routes/sandboxes.ts`, `k8s-clusters.ts`, `domains.ts`).

## What You Can Achieve
- Ship cross-repo changes with AI: generate diffs, open PRs, and review artifacts in one flow.
- Plan multi-repo features using the repo dependency graph to target the right services.
- Validate changes safely: execute in K8s sandboxes, view logs and live previews, iterate until the result looks good, then merge via PR.
- Operate reliably at scale: track runs, stream status, and debug via `/bull-board` and WS logs.
- Integrate your org: connect GitHub, register clusters/domains, and publish preview deploys.

## Build, Test, and Development Commands
- Install: `bun install` (uses workspaces).
- API dev: `bun run dev` (root) or `cd apps/api && bun run dev`.
- Web dev: `bun run dev:web` (root) or `cd apps/web && nvm exec 24 npx vite`.
- DB tasks: `bun run db:generate | db:migrate | db:push | db:studio` and `bun run db:seed`.
- Config: verify `.env` at repo root (copied from `.env.example`). Postgres is preconfigured.

## Coding Style & Naming Conventions
- TypeScript strict; 2-space indent; semicolons; double quotes. API: `src/routes/*.ts`, `src/services/*.service.ts`. Web: components/pages PascalCase; utilities camelCase. Lint Web with `eslint .`.

## Testing Guidelines
- No repo-wide test runner yet. If adding tests, co-locate `*.test.ts[x]`, mock external systems, and target service/route (API) or component/hooks (Web).

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject (e.g., "Add structured logging"). Group related changes.
- PRs: description, linked issue, UI screenshots (if applicable), migration notes, env var changes; verify with `bun run dev`/`dev:web` + migrations.

## Security & Configuration Tips
- Copy `.env.example` to `.env` (root). Never commit secrets. Required: `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_MASTER_KEY`, OAuth/API keys. Web uses Node 24 (`.nvmrc`); API/workers run on Bun.
- K8s config is stored in the DB (`k8s_clusters`) and managed via the Clusters UI; sandboxes/preview domains are created from that configuration.
- Sandbox provider: pluggable via code; default uses K8s. Optional `SANDBOX_PROVIDER` can select alternatives (e.g., `daytona`) when implemented.
- Daytona provider (optional): set `SANDBOX_PROVIDER=daytona` and configure Daytona via env (`DAYTONA_API_KEY`, optional `DAYTONA_API_URL`, `DAYTONA_TARGET`). Provider will clone repos using the GitHub token and expose a preview port.
 - Worker → API registration: to show Daytona sandboxes in the UI, set `INTERNAL_AGENT_API_KEY` in both API and worker envs; optionally set `API_BASE_URL` for the worker (defaults to `http://localhost:3434`).

## End-to-End Examples
- Implement API + Web feature with an agent
  1) Open Command Center, choose provider (Claude/Codex) and mode `implement`.
  2) Prompt: describe the feature, target repos (e.g., apps/api, apps/web), and branch name.
  3) Watch streamed events: plan, diffs, artifacts; iterate with follow‑ups.
  4) On success, follow the PR link in the run or review diffs in the transcript.

- Plan multi‑repo change using dependency graph
  1) Connect GitHub in Connectors; confirm repos appear in Repos.
  2) Inspect relationships in Repos → Dependencies to scope impact.
  3) In Command Center, use mode `plan` to generate a repo‑scoped plan.
  4) Convert the approved plan into an `implement` run to produce diffs/PRs.

- Validate changes and monitor execution
  1) Enable K8s sandboxes in `.env` and register a cluster (Clusters page).
  2) Trigger an `implement` run; the agent clones into a sandbox, builds a preview, and posts logs.
  3) Review the preview via Domains; provide follow‑ups to iterate until acceptable.
  4) Use `/bull-board` for queue health; when satisfied, accept and open the PR from the run.

Note: If `SANDBOX_PROVIDER=daytona`, `clusterId` in sandbox create requests is ignored; Daytona credentials come from `DAYTONA_*` env.
