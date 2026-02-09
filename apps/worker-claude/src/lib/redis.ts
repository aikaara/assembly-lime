import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export function createRedisClient(purpose?: string): Redis {
  const url = new URL(redisUrl);
  const opts: import("ioredis").RedisOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    db: Number(url.pathname?.slice(1)) || 0,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  };
  if (url.protocol === "rediss:") {
    opts.tls = {};
  }
  const client = new Redis(opts);
  client.on("error", (err) => {
    console.error(`[redis:${purpose ?? "default"}]`, err.message);
  });
  return client;
}

export const redis = createRedisClient("worker-claude");

/** Create a dedicated publisher for event streaming */
export function createPublisher(): Redis {
  return createRedisClient("publisher");
}
