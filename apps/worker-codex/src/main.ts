import type { AgentJobPayload } from "@assembly-lime/shared";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/event-emitter";
import { runCodexAgent } from "./agent/codex-runner";

// ── K8s single-run mode ──────────────────────────────────────────────
const encodedPayload = process.env.AGENT_JOB_PAYLOAD;
if (encodedPayload) {
  logger.info("running in K8s job mode");
  const payload: AgentJobPayload = JSON.parse(
    Buffer.from(encodedPayload, "base64").toString("utf-8")
  );
  const emitter = new AgentEventEmitter(payload.runId);
  await runCodexAgent(payload, emitter);
  process.exit(0);
} else {
  // Queue-based execution is now handled by Trigger.dev tasks (apps/trigger/)
  logger.info("worker-codex: no AGENT_JOB_PAYLOAD — queue processing is handled by Trigger.dev");
}
