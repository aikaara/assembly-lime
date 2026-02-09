import { Elysia } from "elysia";
import { db } from "./db";
import { logger } from "./lib/logger";
import { redis, redisSub } from "./lib/redis";
import { agentRunRoutes } from "./routes/agent-runs";
import { imageRoutes } from "./routes/images";
import { previewDeploymentRoutes } from "./routes/preview-deployments";
import { wsRoutes, broadcastToWs } from "./routes/ws";
import { startEventSubscriber } from "./services/event-subscriber";

// Connect Redis clients
await redis.connect();
await redisSub.connect();

// Start event subscriber (Redis pub/sub → persist → WS broadcast)
await startEventSubscriber(db, broadcastToWs);

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .use(agentRunRoutes(db))
  .use(imageRoutes(db))
  .use(previewDeploymentRoutes(db))
  .use(wsRoutes())
  .listen(3434);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "API server started"
);
