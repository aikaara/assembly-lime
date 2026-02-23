import { Elysia } from "elysia";
import { db } from "./db";
import { logger } from "./lib/logger";
import { initSessionStore, pruneExpiredSessions } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { projectRoutes } from "./routes/projects";
import { ticketRoutes } from "./routes/tickets";
import { agentRunRoutes } from "./routes/agent-runs";
import { imageRoutes } from "./routes/images";
import { previewDeploymentRoutes } from "./routes/preview-deployments";
import { connectorRoutes } from "./routes/connectors";
import { repositoryRoutes } from "./routes/repositories";
import { projectRepoRoutes } from "./routes/project-repos";
import { projectRunRoutes } from "./routes/project-runs";
import { sandboxRoutes } from "./routes/sandboxes";
import { k8sClusterRoutes } from "./routes/k8s-clusters";
import { domainRoutes } from "./routes/domains";
import { toolDefinitionRoutes } from "./routes/tool-definitions";
import { repositoryDependencyRoutes } from "./routes/repository-dependencies";
import { envVarRoutes } from "./routes/env-vars";
import { wsRoutes } from "./routes/ws";
import { internalEventRoutes } from "./routes/internal-events";
import { githubWebhookRoutes } from "./routes/github-webhook";

// ── Initialize session store ─────────────────────────────────────────
initSessionStore(db);

// ── Start HTTP server FIRST so health checks pass immediately ────────
const port = Number(process.env.PORT) || 3434;

const app = new Elysia()
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    if (url.pathname !== "/health") {
      logger.info({ method: request.method, path: url.pathname }, "incoming request");
    }
  })
  .onError(({ request, error }) => {
    const url = new URL(request.url);
    const msg = "message" in error ? error.message : String(error);
    logger.error({ method: request.method, path: url.pathname, err: msg }, "request error");
  })
  .get("/health", () => ({ ok: true }))
  .use(authRoutes(db))
  .use(meRoutes(db))
  .use(projectRoutes(db))
  .use(ticketRoutes(db))
  .use(agentRunRoutes(db))
  .use(imageRoutes(db))
  .use(previewDeploymentRoutes(db))
  .use(connectorRoutes(db))
  .use(repositoryRoutes(db))
  .use(projectRepoRoutes(db))
  .use(projectRunRoutes(db))
  .use(sandboxRoutes(db))
  .use(k8sClusterRoutes(db))
  .use(domainRoutes(db))
  .use(toolDefinitionRoutes(db))
  .use(repositoryDependencyRoutes(db))
  .use(envVarRoutes(db))
  .use(internalEventRoutes(db))
  .use(githubWebhookRoutes(db))
  .use(wsRoutes())
  .listen({ port, hostname: "0.0.0.0" });

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "API server started"
);

// ── Prune expired sessions hourly ────────────────────────────────────
setInterval(async () => {
  try {
    await pruneExpiredSessions();
  } catch (err) {
    logger.error({ err }, "failed to prune expired sessions");
  }
}, 60 * 60 * 1000);
