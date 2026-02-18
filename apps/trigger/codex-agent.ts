import { task, logger } from "@trigger.dev/sdk/v3";
import {
  DaytonaWorkspace,
  getDaytonaSandboxUrl,
  type AgentJobPayload,
} from "@assembly-lime/shared";
import { AgentEventEmitter } from "../worker-codex/src/agent/event-emitter";
import { runCodexAgent } from "../worker-codex/src/agent/codex-runner";
import { launchK8sJob } from "../worker-codex/src/k8s/job-launcher";
import { detectStartAndPort } from "../worker-codex/src/agent/detect-start-config";

const USE_K8S_SANDBOX = process.env.USE_K8S_SANDBOX === "true";

export const codexAgentTask = task({
  id: "codex-agent",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    logger.info("processing codex agent job", { runId: payload.runId });

    // Daytona workspace path
    if (payload.sandbox?.provider === "daytona" && payload.repo) {
      logger.info("using Daytona workspace", { runId: payload.runId });
      try {
        const emitter = new AgentEventEmitter(payload.runId);
        const workspace = await DaytonaWorkspace.create({
          runId: payload.runId,
          provider: payload.provider,
          mode: payload.mode,
          repo: payload.repo,
        });
        logger.info("daytona sandbox created", { sandboxId: workspace.sandbox.id });

        // Emit sandbox URL immediately so user can watch in real-time
        const sandboxUrl = getDaytonaSandboxUrl(workspace.sandbox.id);
        await emitter.emitSandbox(workspace.sandbox.id, sandboxUrl);

        const branchName = `al/${payload.mode}/${payload.runId}`;
        await workspace.createBranch(branchName);

        // Inject env vars if provided
        if (payload.sandbox?.envVars) {
          await workspace.injectEnvVars(payload.sandbox.envVars);
          logger.info("env vars injected into workspace", {
            keyCount: Object.keys(payload.sandbox.envVars).length,
          });
        }
        // 1. Run codex agent (text generation)
        await runCodexAgent(payload, emitter);

        // 2. Start dev server + preview
        const config = await detectStartAndPort(workspace.sandbox, workspace.repoDir);
        logger.info("daytona: detected start config", {
          installCommand: config.installCommand,
          startCommand: config.startCommand,
          port: config.port,
          portSource: config.portSource,
        });

        if (config.installCommand) {
          await workspace.exec(`cd ${workspace.repoDir} && ${config.installCommand}`, 600);
        }

        const sessionId = `run-${payload.runId}`;
        await workspace.sandbox.process.createSession(sessionId);
        await workspace.sandbox.process.executeSessionCommand(
          sessionId,
          { command: `cd ${workspace.repoDir} && ${config.startCommand}`, runAsync: true },
          0,
        );
        logger.info("daytona: dev server starting in background session");

        // 3. Preview URL + register
        const previewUrl = await workspace.getSignedPreviewUrl(config.port, 3600);
        if (previewUrl) {
          await emitter.emit({ type: "preview", previewUrl, branch: branchName, status: "active" });
          logger.info("daytona: preview link emitted", { previewUrl });

          try {
            const apiBase = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
            const internalKey = process.env.INTERNAL_AGENT_API_KEY;
            if (internalKey) {
              const body = {
                tenantId: payload.tenantId,
                repositoryId: payload.repo.repositoryId,
                branch: branchName,
                sandboxId: workspace.sandbox.id,
                previewUrl,
                status: "running",
                ports: [{ containerPort: config.port, source: config.portSource, provider: "daytona" }],
              };
              await fetch(`${apiBase}/sandboxes/register-internal`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-internal-key": internalKey,
                },
                body: JSON.stringify(body),
              });
              logger.info("daytona: sandbox registered with API", { sandboxId: workspace.sandbox.id });
            } else {
              logger.warn("INTERNAL_AGENT_API_KEY not set; skipping sandbox registration");
            }
          } catch (e) {
            logger.warn("daytona: failed to register sandbox in API", { err: (e as Error)?.message });
          }
        }
      } catch (e) {
        logger.warn("daytona: workspace setup failed", { err: (e as Error)?.message });
      }
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
    await runCodexAgent(payload, emitter);
  },
});
