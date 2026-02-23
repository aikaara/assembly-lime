import { task, wait, logger } from "@trigger.dev/sdk/v3";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { runUnifiedAgent } from "../worker-agent/src/run";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

async function storeApprovalToken(runId: number, tokenId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/internal/agent-approval-token/${runId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": INTERNAL_KEY,
    },
    body: JSON.stringify({ approvalTokenId: tokenId }),
  });
}

export const agentTask = task({
  id: "agent-task",
  maxDuration: 14400,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    logger.info("processing unified agent job", {
      runId: payload.runId,
      provider: payload.provider,
      mode: payload.mode,
    });

    const result = await runUnifiedAgent(payload);

    // If agent needs approval, checkpoint via wait.forToken() (zero compute)
    if (result.needsApproval) {
      const token = await wait.createToken({
        timeout: "24h",
        idempotencyKey: `approval-${payload.runId}`,
        tags: [`run-${payload.runId}`],
      });

      // Persist token ID so the API can complete it on user approve/reject
      await storeApprovalToken(payload.runId, token.id);

      logger.info("waiting for approval", {
        runId: payload.runId,
        tokenId: token.id,
        approvalMode: result.approvalMode,
      });

      // Task checkpoints here via CRIU — zero compute cost during wait
      const approval = await wait.forToken<{
        approved: boolean;
        action?: string;
      }>(token);

      if (approval.ok && approval.output.approved) {
        logger.info("approval received", {
          runId: payload.runId,
          action: approval.output.action,
        });

        // The API-side approve endpoint handles the actual PR creation
        // or plan-to-implement transition, so no additional work here.
        // The wait.completeToken() call from the API is the signal.
      } else {
        logger.info("approval rejected or timed out", {
          runId: payload.runId,
          ok: approval.ok,
        });
      }

      // Cleanup: stop sandbox after approval flow completes (approved or rejected)
      if (result.workspace) {
        try {
          logger.info("stopping sandbox after approval flow", {
            runId: payload.runId,
            sandboxId: result.workspace.sandbox.id,
          });
          await result.workspace.stop();
        } catch (err) {
          logger.warn("failed to stop sandbox post-approval", { err });
        }
      }
    }
  },
});
