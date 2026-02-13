import { Queue, Worker, type Job } from "bullmq";
import { redis, createRedisClient } from "./redis";
import {
  QUEUE_AGENT_RUNS_CLAUDE,
  QUEUE_AGENT_RUNS_CODEX,
  QUEUE_DEPENDENCY_SCANS,
  type AgentJobPayload,
} from "@assembly-lime/shared";
import { childLogger } from "./logger";

const log = childLogger({ module: "bullmq" });

// ── Agent queues ────────────────────────────────────────────────────

export const claudeQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CLAUDE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const codexQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CODEX, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export function getQueueForProvider(
  provider: "claude" | "codex"
): Queue<AgentJobPayload> {
  return provider === "claude" ? claudeQueue : codexQueue;
}

// ── Dependency scan queue ───────────────────────────────────────────

export type DepScanJobPayload = { tenantId: number };

export const depScanQueue = new Queue<DepScanJobPayload>(QUEUE_DEPENDENCY_SCANS, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

/** Logger callback that writes to both pino and BullMQ job.log */
export type JobLogger = (message: string) => Promise<void>;

function makeJobLogger(job: Job): JobLogger {
  return async (message: string) => {
    log.info({ jobId: job.id }, message);
    await job.log(message);
  };
}

/**
 * Start the dependency scan worker.
 * Called once from index.ts after DB is ready.
 * Uses a dedicated Redis connection (BullMQ requirement for workers).
 */
export function startDepScanWorker(
  processFn: (tenantId: number, jobLog: JobLogger, updateProgress: (pct: number) => Promise<void>) => Promise<void>
): Worker<DepScanJobPayload> {
  const worker = new Worker<DepScanJobPayload>(
    QUEUE_DEPENDENCY_SCANS,
    async (job) => {
      const jobLog = makeJobLogger(job);
      await jobLog(`Dependency scan started for tenant ${job.data.tenantId}`);
      await job.updateProgress(0);

      await processFn(
        job.data.tenantId,
        jobLog,
        async (pct) => { await job.updateProgress(pct); }
      );

      await jobLog("Dependency scan finished");
      await job.updateProgress(100);
    },
    {
      connection: createRedisClient("dep-scan-worker"),
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    log.info({ jobId: job.id, tenantId: job.data.tenantId }, "dep scan job completed");
  });

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, tenantId: job?.data.tenantId, err: err.message },
      "dep scan job failed"
    );
  });

  return worker;
}
