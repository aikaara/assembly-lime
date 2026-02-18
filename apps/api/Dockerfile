# Stage 1 — Install production dependencies
FROM oven/bun:1 AS deps

WORKDIR /app

# Copy workspace root manifests
COPY package.json bun.lock ./

# Copy ALL workspace package.json files so frozen lockfile resolves
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker-claude/package.json apps/worker-claude/package.json
COPY apps/worker-codex/package.json apps/worker-codex/package.json
COPY apps/trigger/package.json apps/trigger/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile

# Stage 2 — Runtime
FROM oven/bun:1-slim

WORKDIR /app

# Copy installed deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source files (no build step — Bun runs TS directly)
COPY package.json tsconfig.json ./
COPY apps/api/src ./apps/api/src
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/

EXPOSE 3434

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3434/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

ENV NODE_ENV=production

CMD ["bun", "run", "apps/api/src/index.ts"]
