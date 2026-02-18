import type { AgentJobPayload } from "@assembly-lime/shared";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/event-emitter";
import { runClaudeAgent } from "./agent/claude-runner";
import { runWorkspaceAgent } from "./agent/workspace-runner";

// ── K8s single-run mode ──────────────────────────────────────────────
// When launched as a K8s Job, the payload is in AGENT_JOB_PAYLOAD env var.
const encodedPayload = process.env.AGENT_JOB_PAYLOAD;
if (encodedPayload) {
  logger.info("running in K8s job mode");
  const payload: AgentJobPayload = JSON.parse(
    Buffer.from(encodedPayload, "base64").toString("utf-8")
  );
  const emitter = new AgentEventEmitter(payload.runId);
  const workspaceDir = process.env.WORKSPACE_DIR;
  if (workspaceDir && payload.repo) {
    logger.info({ workspaceDir }, "routing to workspace agent");
    await runWorkspaceAgent(payload, emitter);
  } else if (payload.repo) {
    await runClaudeAgent(payload, emitter);
  } else {
    await emitter.emitError("No repository specified — cannot run agent without a sandbox");
    await emitter.emitStatus("failed", "No repository specified");
    logger.error({ runId: payload.runId }, "K8s job rejected: no repo specified");
  }
  process.exit(0);
} else {
  // Queue-based execution is now handled by Trigger.dev tasks (apps/trigger/)
  logger.info("worker-claude: no AGENT_JOB_PAYLOAD — queue processing is handled by Trigger.dev");
}
