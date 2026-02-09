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
import { wsRoutes, broadcastToWs } from "./routes/ws";
import { startEventSubscriber } from "./services/event-subscriber";

// Connect Redis clients (guard: BullMQ may have already connected the shared instance)
if (redis.status === "wait") await redis.connect();
if (redisSub.status === "wait") await redisSub.connect();

// Start event subscriber (Redis pub/sub → persist → WS broadcast)
await startEventSubscriber(db, broadcastToWs);

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .use(authRoutes(db))
  .use(meRoutes(db))
  .use(projectRoutes(db))
  .use(ticketRoutes(db))
  .use(agentRunRoutes(db))
  .use(imageRoutes(db))
  .use(previewDeploymentRoutes(db))
  .use(wsRoutes())
  .listen(3434);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "API server started"
);
