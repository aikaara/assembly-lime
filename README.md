# Assembly Lime

Multi-tenant software factory dashboard where PM/Dev/QA collaborate on planning and execution with AI agents (Claude + Codex), connected to GitHub repositories and deployment pipelines.

## Tech Stack

- **Runtime:** Bun (API, workers) / Node (web/Vite)
- **API:** Elysia (Bun-native)
- **Frontend:** React + Vite + Tailwind + Radix UI
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Queue:** Trigger.dev v3 (managed cloud)
- **Auth:** GitHub OAuth + PostgreSQL sessions
- **Realtime:** WebSocket + HTTP POST callbacks

## Setup

```bash
# Install dependencies
bun install

# Copy env and fill in values
cp .env.example .env

# Apply database schema
bun db:push

# Seed dev data
bun db:seed
```

## Development

Requires two terminals:

```bash
# Terminal 1: API + web + workers
bun dev:all

# Terminal 2: Trigger.dev local dev worker (processes agent runs + dep scans)
bun trigger:dev
```

`bun dev:all` starts the API (`:3434`), web frontend (`:5173`), and workers. Trigger.dev runs separately — it connects to the Trigger.dev cloud, pulls dispatched tasks, and executes them locally.

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TRIGGER_SECRET_KEY` | Trigger.dev API key (from dashboard) |
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude agent) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex agent) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials |
| `INTERNAL_AGENT_API_KEY` | Shared secret for worker-to-API callbacks |
| `ENCRYPTION_MASTER_KEY` | Envelope encryption key for secrets |

## Monorepo Structure

```
apps/
  api/              # Bun + Elysia API server
  web/              # React + Vite frontend
  trigger/          # Trigger.dev task definitions (agent runs, dep scans)
  worker-claude/    # Claude Agent SDK runner (K8s mode)
  worker-codex/     # Codex runner (K8s mode)
packages/
  shared/           # Types, Zod schemas, DB schema, event protocol
```

## Deployment

### API (DigitalOcean / Railway / Fly.io / any Docker host)

```bash
# Production via PM2
bun start
```

Set all env vars from `.env.example` on your hosting platform.

### Trigger.dev Workers

```bash
# Deploy tasks to Trigger.dev cloud
bun trigger:deploy
```

Set these env vars in the [Trigger.dev dashboard](https://trigger.dev) (Environment Variables):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `API_BASE_URL`, `INTERNAL_AGENT_API_KEY`, `DATABASE_URL` (for dep-scan).

### Frontend (Vercel / Netlify / Cloudflare Pages)

Build command: `cd apps/web && bun run build`
Output directory: `apps/web/dist`
Environment variable: `VITE_API_URL` (set to your deployed API URL)


Deployment Guide                                                                                                                      
                                                                                                                                        
  1. API (DigitalOcean App Platform / Railway / Fly.io)                                                                                 
                                                                                                                                        
  You're already on DO App Platform. The API runs via PM2:                                                                            

  bun install && bun start

  Required env vars on the platform:
  DATABASE_URL, TRIGGER_SECRET_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, INTERNAL_AGENT_API_KEY,
  ENCRYPTION_MASTER_KEY, API_BASE_URL (set to your deployed URL, e.g. https://api.assemblylime.dev)

  2. Trigger.dev Workers

  No infrastructure to manage — tasks run on Trigger.dev's cloud:

  bun trigger:deploy

  Then set these env vars in the Trigger.dev dashboard (Project → Environment Variables):
  - ANTHROPIC_API_KEY, OPENAI_API_KEY
  - API_BASE_URL (your deployed API URL)
  - INTERNAL_AGENT_API_KEY (same value as the API's)
  - DATABASE_URL (needed by dep-scan task)
  - DAYTONA_API_KEY, DAYTONA_SERVER_URL (if using Daytona sandboxes)

  3. Frontend (Vercel / Netlify / Cloudflare Pages)

  The frontend is a static Vite/React app. The /api proxy only works in dev — in production, the frontend needs to know the API URL.

  Vercel:
  - Root directory: apps/web
  - Build command: npx vite build --mode production
  - Output directory: dist
  - Framework preset: Vite

  Netlify:
  - Base directory: apps/web
  - Build command: npx vite build --mode production
  - Publish directory: apps/web/dist

  Cloudflare Pages:
  - Build command: cd apps/web && npx vite build --mode production
  - Build output directory: apps/web/dist

  For all three, the web app currently uses /api as a relative path prefix (proxied in dev). In production you'll need the API calls to
  reach your deployed API. The simplest approach is either:
  - Reverse proxy on the hosting platform: route /api/* to your API server
  - CORS + env var: add a VITE_API_URL env var and update fetch calls to use it

  The build:prod script in apps/web/package.json already exists (npx vite build --mode production), so you can use that directly without
   needing nvm.