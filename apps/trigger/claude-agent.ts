import { task, logger } from "@trigger.dev/sdk/v3";
import {
  DaytonaWorkspace,
  getDaytonaSandboxUrl,
  type AgentJobPayload,
} from "@assembly-lime/shared";
import { AgentEventEmitter } from "../worker-claude/src/agent/event-emitter";
import { runClaudeAgent } from "../worker-claude/src/agent/claude-runner";
import { runClaudeAgentMultiRepo } from "../worker-claude/src/agent/multi-repo-runner";
import { runWorkspaceAgent } from "../worker-claude/src/agent/workspace-runner";
import { runDaytonaWorkspaceAgent } from "../worker-claude/src/agent/daytona-workspace-runner";
import { launchK8sJob } from "../worker-claude/src/k8s/job-launcher";

const USE_K8S_SANDBOX = process.env.USE_K8S_SANDBOX === "true";

export const claudeAgentTask = task({
  id: "claude-agent",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    logger.info("processing claude agent job", { runId: payload.runId });

    // Daytona workspace path
    if (payload.sandbox?.provider === "daytona" && payload.repo) {
      logger.info("using Daytona workspace", { runId: payload.runId });
      const emitter = new AgentEventEmitter(payload.runId);
      const workspace = await DaytonaWorkspace.create({
        runId: payload.runId,
        provider: payload.provider,
        mode: payload.mode,
        repo: payload.repo,
      });

      // Emit sandbox URL immediately so user can watch in real-time
      const sandboxUrl = getDaytonaSandboxUrl(workspace.sandbox.id);
      await emitter.emitSandbox(workspace.sandbox.id, sandboxUrl);

      const branchName = `al/${payload.mode}/${payload.runId}`;
      await workspace.createBranch(branchName);

      // Inject env vars if provided
      if (payload.sandbox.envVars) {
        await workspace.injectEnvVars(payload.sandbox.envVars);
        logger.info("env vars injected into workspace", {
          keyCount: Object.keys(payload.sandbox.envVars).length,
        });
      }

      await runDaytonaWorkspaceAgent(payload, emitter, workspace);
      return;
    }

    // K8s delegation
    if (USE_K8S_SANDBOX) {
      logger.info("delegating to K8s sandbox", { runId: payload.runId });
      await launchK8sJob(payload);
      return;
    }

    // Direct execution mode (dev)
    const emitter = new AgentEventEmitter(payload.runId);
    if (payload.repos && payload.repos.length > 0) {
      await runClaudeAgentMultiRepo(payload, emitter);
    } else {
      await runClaudeAgent(payload, emitter);
    }
  },
});
