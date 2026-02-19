import type { AgentJobPayload } from "@assembly-lime/shared";
import { DaytonaWorkspace, getDaytonaSandboxUrl } from "@assembly-lime/shared";
import type { OperationsBundle } from "@assembly-lime/pi-coding-agent-tools";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/emitter";
import { createAgent } from "./agent/factory";
import { bridgeEvents } from "./agent/event-bridge";
import { buildToolSet } from "./tools/index";
import { buildSystemPrompt } from "./agent/system-prompt";
import { createLocalOps } from "./ops/local-ops";
import { createDaytonaOps } from "./ops/daytona-ops";
import type { GitOperations } from "./tools/git";
import type { PRContext } from "./tools/create-pr";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runUnifiedAgent(payload: AgentJobPayload): Promise<void> {
  const log = logger.child({ runId: payload.runId, provider: payload.provider, mode: payload.mode });
  const emitter = new AgentEventEmitter(payload.runId);

  let workDir: string | undefined;
  let workspace: DaytonaWorkspace | undefined;

  try {
    // 1. Detect execution mode
    const useDaytona = payload.sandbox?.provider === "daytona" && !!payload.repo;

    let ops: OperationsBundle;
    let gitOps: GitOperations;
    let cwd: string;

    if (useDaytona && payload.repo) {
      // ── Daytona path ────────────────────────────────────────────
      log.info("creating Daytona workspace");
      workspace = await DaytonaWorkspace.create({
        runId: payload.runId,
        provider: payload.provider,
        mode: payload.mode,
        repo: {
          cloneUrl: payload.repo.cloneUrl,
          name: payload.repo.name,
          defaultBranch: payload.repo.defaultBranch,
          ref: payload.repo.ref,
          authToken: payload.repo.authToken,
        },
      });

      // Emit sandbox URL immediately
      const sandboxUrl = getDaytonaSandboxUrl(workspace.sandbox.id);
      await emitter.emitArtifact("sandbox", sandboxUrl, "text/html");
      log.info({ sandboxId: workspace.sandbox.id }, "Daytona workspace created");

      // Create working branch
      const branchName = `al/${payload.mode}/${payload.runId}`;
      await workspace.createBranch(branchName);
      log.info({ branch: branchName }, "working branch created");

      // Inject env vars if provided
      const envVars = payload.sandbox?.envVars;
      if (envVars && Object.keys(envVars).length > 0) {
        await workspace.injectEnvVars(envVars);
      }

      ops = createDaytonaOps(workspace);
      cwd = workspace.repoDir;

      gitOps = {
        exec: async (args: string[]) => {
          return workspace!.exec(`git ${args.join(" ")}`);
        },
      };
    } else {
      // ── Local path ──────────────────────────────────────────────
      workDir = await mkdtemp(join(tmpdir(), `agent-run-${payload.runId}-`));
      log.info({ workDir }, "local workspace created");

      if (payload.repo) {
        const cloneUrl = buildCloneUrl(payload.repo.cloneUrl, payload.repo.authToken);

        log.info({ repo: `${payload.repo.owner}/${payload.repo.name}` }, "cloning repository");
        const clone = Bun.spawn(
          ["git", "clone", "--depth", "50", cloneUrl, "."],
          { cwd: workDir, stdout: "pipe", stderr: "pipe" },
        );
        const cloneErr = await new Response(clone.stderr).text();
        const cloneCode = await clone.exited;
        if (cloneCode !== 0) {
          throw new Error(`git clone failed (exit ${cloneCode}): ${cloneErr}`);
        }

        // Create working branch
        const branchName = `al/${payload.mode}/${payload.runId}`;
        await Bun.spawn(
          ["git", "checkout", "-b", branchName],
          { cwd: workDir, stdout: "pipe", stderr: "pipe" },
        ).exited;
        log.info({ branch: branchName }, "working branch created");

        // Configure git user
        await Bun.spawn(
          ["git", "config", "user.email", "agent@assemblylime.dev"],
          { cwd: workDir, stdout: "pipe", stderr: "pipe" },
        ).exited;
        await Bun.spawn(
          ["git", "config", "user.name", "AssemblyLime Agent"],
          { cwd: workDir, stdout: "pipe", stderr: "pipe" },
        ).exited;
      }

      ops = createLocalOps(workDir);
      cwd = workDir;

      gitOps = {
        exec: async (args: string[]) => {
          const proc = Bun.spawn(["git", ...args], {
            cwd: workDir!,
            stdout: "pipe",
            stderr: "pipe",
          });
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          return { stdout: stdout + stderr, exitCode };
        },
      };
    }

    // 2. Build PR context
    let prContext: PRContext | undefined;
    if (payload.repo?.authToken) {
      prContext = {
        owner: payload.repo.owner,
        name: payload.repo.name,
        defaultBranch: payload.repo.defaultBranch,
        authToken: payload.repo.authToken,
      };
    }

    // 3. Build tools
    const { tools, toolRegistry } = buildToolSet(cwd, payload.mode, ops, gitOps, {
      prContext,
      emitter,
    });
    log.info({ toolCount: tools.length, mode: payload.mode }, "tools built");

    // 4. Build system prompt
    const systemPrompt = buildSystemPrompt({
      mode: payload.mode,
      resolvedPrompt: payload.resolvedPrompt,
      selectedTools: tools.map((t) => t.name),
      cwd,
    });

    // 5. Create agent
    const agent = createAgent({
      providerId: payload.provider,
      mode: payload.mode,
      systemPrompt,
      tools,
    });

    // 6. Bridge events
    const unsubscribe = agent.subscribe(bridgeEvents(emitter, log));

    // 7. Run the prompt
    log.info("starting agent prompt");
    await agent.prompt(payload.inputPrompt);
    await agent.waitForIdle();

    unsubscribe();
    log.info("agent run completed");

    // 8. Post-run: auto-commit + push (implement/bugfix only)
    if (payload.repo && (payload.mode === "implement" || payload.mode === "bugfix")) {
      if (workspace) {
        await postRunDaytona(workspace, emitter, log, prContext);
      } else if (workDir) {
        await postRunLocal(workDir, emitter, log);
      }
    }

    // 9. Preview (Daytona only, implement/bugfix modes)
    if (workspace && (payload.mode === "implement" || payload.mode === "bugfix")) {
      try {
        const sessionId = `preview-${payload.runId}`;
        const devServer = await workspace.startDevServer(sessionId);
        if (devServer.previewUrl) {
          await emitter.emitArtifact("preview", devServer.previewUrl, "text/html");
          log.info({ previewUrl: devServer.previewUrl, port: devServer.port }, "preview started");
        }
      } catch (err) {
        log.warn({ err }, "failed to start dev server (non-fatal)");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ err }, "agent run failed");
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
  } finally {
    // Clean up local workspace (Daytona workspaces persist for preview)
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildCloneUrl(cloneUrl: string, authToken?: string): string {
  if (!authToken) return cloneUrl;
  try {
    const url = new URL(cloneUrl);
    url.username = "x-access-token";
    url.password = authToken;
    return url.toString();
  } catch {
    return cloneUrl;
  }
}

async function postRunDaytona(
  workspace: DaytonaWorkspace,
  emitter: AgentEventEmitter,
  log: ReturnType<typeof logger.child>,
  prContext?: PRContext,
): Promise<void> {
  const { stdout: status } = await workspace.exec("git status --porcelain");
  if (!status.trim()) return;

  log.info("auto-committing remaining changes (Daytona)");

  await workspace.stageAll();
  const sha = await workspace.commit(
    "chore: auto-commit remaining agent changes",
    "AssemblyLime Agent",
    "agent@assemblylime.dev",
  );
  log.info({ sha }, "committed");

  await workspace.push();
  log.info("pushed to remote");

  const defaultBranch = prContext?.defaultBranch ?? "main";
  const diff = await workspace.getDiffUnified(`origin/${defaultBranch}`);
  if (diff.trim()) {
    await emitter.emitDiff(diff.trim(), "Auto-committed remaining changes");
  }
}

async function postRunLocal(
  workDir: string,
  emitter: AgentEventEmitter,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const status = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const statusOut = await new Response(status.stdout).text();
  await status.exited;

  if (!statusOut.trim()) return;

  log.info("auto-committing remaining changes (local)");

  await Bun.spawn(["git", "add", "-A"], { cwd: workDir, stdout: "pipe", stderr: "pipe" }).exited;
  await Bun.spawn(
    ["git", "commit", "-m", "chore: auto-commit remaining agent changes"],
    { cwd: workDir, stdout: "pipe", stderr: "pipe" },
  ).exited;

  const push = Bun.spawn(
    ["git", "push", "--set-upstream", "origin", "HEAD"],
    { cwd: workDir, stdout: "pipe", stderr: "pipe" },
  );
  const pushErr = await new Response(push.stderr).text();
  const pushCode = await push.exited;

  if (pushCode !== 0) {
    log.warn({ error: pushErr }, "auto-push failed (non-fatal)");
  }

  const diff = Bun.spawn(["git", "diff", "HEAD~1"], {
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const diffOut = await new Response(diff.stdout).text();
  await diff.exited;
  if (diffOut.trim()) {
    await emitter.emitDiff(diffOut.trim(), "Auto-committed remaining changes");
  }
}
