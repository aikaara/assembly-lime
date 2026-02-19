import { task, logger } from "@trigger.dev/sdk/v3";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { runUnifiedAgent } from "../worker-agent/src/run";

/**
 * Legacy task ID kept for backwards compatibility.
 * All runs now route through the unified agent.
 */
export const codexAgentTask = task({
  id: "codex-agent",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    logger.info("codex-agent task forwarding to unified agent", {
      runId: payload.runId,
      provider: payload.provider,
      mode: payload.mode,
    });
    await runUnifiedAgent(payload);
  },
});
