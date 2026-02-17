import { Queue, Worker, type Job } from "bunqueue/client";
import {
  QUEUE_AGENT_RUNS_CLAUDE,
  QUEUE_AGENT_RUNS_CODEX,
  QUEUE_DEPENDENCY_SCANS,
  type AgentJobPayload,
} from "@assembly-lime/shared";
import { childLogger } from "./logger";

const log = childLogger({ module: "queue" });

const connection = {
  host: process.env.BUNQUEUE_HOST ?? "localhost",
  port: Number(process.env.BUNQUEUE_PORT) || 6789,
};

// ── Agent queues ────────────────────────────────────────────────────

export const claudeQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CLAUDE, {
  connection,
});

export const codexQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CODEX, {
  connection,
});

export function getQueueForProvider(
  provider: "claude" | "codex"
): Queue<AgentJobPayload> {
  return provider === "claude" ? claudeQueue : codexQueue;
}

// ── Dependency scan queue ───────────────────────────────────────────

export type DepScanJobPayload = { tenantId: number };

export const depScanQueue = new Queue<DepScanJobPayload>(QUEUE_DEPENDENCY_SCANS, {
  connection,
});

/** Logger callback that writes to both pino and job.log */
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
      connection,
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
