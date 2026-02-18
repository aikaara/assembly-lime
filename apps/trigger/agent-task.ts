import { task, logger } from "@trigger.dev/sdk/v3";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { runUnifiedAgent } from "../worker-agent/src/run";

export const agentTask = task({
  id: "agent-task",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    logger.info("processing unified agent job", {
      runId: payload.runId,
      provider: payload.provider,
      mode: payload.mode,
    });
    await runUnifiedAgent(payload);
  },
});
