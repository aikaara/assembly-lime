import { Worker } from "bullmq";
import {
  QUEUE_AGENT_RUNS_CLAUDE,
  type AgentJobPayload,
} from "@assembly-lime/shared";
import { redis, createPublisher } from "./lib/redis";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/event-emitter";
import { runClaudeAgent } from "./agent/claude-runner";
import { launchK8sJob } from "./k8s/job-launcher";

const USE_K8S_SANDBOX = process.env.USE_K8S_SANDBOX === "true";

// ── K8s single-run mode ──────────────────────────────────────────────
// When launched as a K8s Job, the payload is in AGENT_JOB_PAYLOAD env var.
const encodedPayload = process.env.AGENT_JOB_PAYLOAD;
if (encodedPayload) {
  logger.info("running in K8s job mode");
  const payload: AgentJobPayload = JSON.parse(
    Buffer.from(encodedPayload, "base64").toString("utf-8")
  );
  const pub = createPublisher();
  await pub.connect();
  const emitter = new AgentEventEmitter(pub, payload.runId);
  try {
    await runClaudeAgent(payload, emitter);
  } finally {
    await pub.quit();
  }
  process.exit(0);
}

// ── BullMQ worker mode ───────────────────────────────────────────────
await redis.connect();

const worker = new Worker<AgentJobPayload>(
  QUEUE_AGENT_RUNS_CLAUDE,
  async (job) => {
    const payload = job.data;
    const log = logger.child({ runId: payload.runId, jobId: job.id });
    log.info("processing claude agent job");

    if (USE_K8S_SANDBOX) {
      log.info("delegating to K8s sandbox");
      await launchK8sJob(payload);
      return;
    }

    // Direct execution mode (dev)
    const pub = createPublisher();
    await pub.connect();
    const emitter = new AgentEventEmitter(pub, payload.runId);
    try {
      await runClaudeAgent(payload, emitter);
    } finally {
      await pub.quit();
    }
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "job failed");
});

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "job completed");
});

logger.info("worker-claude: listening for jobs");
