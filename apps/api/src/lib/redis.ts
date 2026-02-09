import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

function createRedisClient(purpose?: string): Redis {
  const url = new URL(redisUrl);
  const opts: import("ioredis").RedisOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    db: Number(url.pathname?.slice(1)) || 0,
    maxRetriesPerRequest: null, // required by BullMQ
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

/** Shared connection for general use (queries, pub) */
export const redis = createRedisClient("main");

/** Dedicated subscriber connection (cannot issue commands while subscribed) */
export const redisSub = createRedisClient("sub");

/** Create a fresh connection (e.g. for BullMQ workers) */
export { createRedisClient };
