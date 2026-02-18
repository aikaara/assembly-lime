# Stage 1 — Install production dependencies
FROM oven/bun:1 AS deps

WORKDIR /app

# Copy workspace root manifests
COPY package.json bun.lock ./

# Copy workspace package.json files so Bun resolves workspaces
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --production

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
