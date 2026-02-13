import { Elysia } from "elysia";
import { db } from "./db";
import { logger } from "./lib/logger";
import { redis, redisSub } from "./lib/redis";
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
import { sandboxRoutes } from "./routes/sandboxes";
import { k8sClusterRoutes } from "./routes/k8s-clusters";
import { domainRoutes } from "./routes/domains";
import { toolDefinitionRoutes } from "./routes/tool-definitions";
import { repositoryDependencyRoutes } from "./routes/repository-dependencies";
import { wsRoutes, broadcastToWs } from "./routes/ws";
import { startEventSubscriber } from "./services/event-subscriber";

// Connect Redis clients (guard: BullMQ may have already connected the shared instance)
if (redis.status === "wait") await redis.connect();
if (redisSub.status === "wait") await redisSub.connect();

// Start event subscriber (Redis pub/sub → persist → WS broadcast)
await startEventSubscriber(db, broadcastToWs);

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
  .use(sandboxRoutes(db))
  .use(k8sClusterRoutes(db))
  .use(domainRoutes(db))
  .use(toolDefinitionRoutes(db))
  .use(repositoryDependencyRoutes(db))
  .use(wsRoutes())
  .listen(3434);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "API server started"
);
