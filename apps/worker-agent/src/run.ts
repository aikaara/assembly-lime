import type { AgentJobPayload } from "@assembly-lime/shared";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/emitter";
import { createAgent } from "./agent/factory";
import { bridgeEvents } from "./agent/event-bridge";
import { buildTools } from "./tools/index";
import type { PRContext } from "./tools/create-pr";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runUnifiedAgent(payload: AgentJobPayload): Promise<void> {
  const log = logger.child({ runId: payload.runId, provider: payload.provider, mode: payload.mode });
  const emitter = new AgentEventEmitter(payload.runId);

  let workDir: string | undefined;

  try {
    // 1. Set up workspace directory
    workDir = await mkdtemp(join(tmpdir(), `agent-run-${payload.runId}-`));
    log.info({ workDir }, "workspace created");

    // 2. Clone repo if provided
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

      // 3. Create working branch
      const branchName = `al/${payload.mode}/${payload.runId}`;
      const branch = Bun.spawn(
        ["git", "checkout", "-b", branchName],
        { cwd: workDir, stdout: "pipe", stderr: "pipe" },
      );
      await branch.exited;
      log.info({ branch: branchName }, "working branch created");

      // Configure git user for commits
      await Bun.spawn(
        ["git", "config", "user.email", "agent@assemblylime.dev"],
        { cwd: workDir, stdout: "pipe", stderr: "pipe" },
      ).exited;
      await Bun.spawn(
        ["git", "config", "user.name", "AssemblyLime Agent"],
        { cwd: workDir, stdout: "pipe", stderr: "pipe" },
      ).exited;
    }

    // 4. Build PR context if we have repo auth
    let prContext: PRContext | undefined;
    if (payload.repo?.authToken) {
      prContext = {
        owner: payload.repo.owner,
        name: payload.repo.name,
        defaultBranch: payload.repo.defaultBranch,
        authToken: payload.repo.authToken,
      };
    }

    // 5. Build tools
    const tools = buildTools(workDir, payload.mode, prContext);
    log.info({ toolCount: tools.length, mode: payload.mode }, "tools built");

    // 6. Create agent
    const agent = createAgent({
      providerId: payload.provider,
      mode: payload.mode,
      systemPrompt: payload.resolvedPrompt,
      tools,
    });

    // 7. Bridge events
    const unsubscribe = agent.subscribe(bridgeEvents(emitter, log));

    // 8. Run the prompt
    log.info("starting agent prompt");
    await agent.prompt(payload.inputPrompt);
    await agent.waitForIdle();

    unsubscribe();
    log.info("agent run completed");

    // 9. Post-run: auto-commit + push any uncommitted changes (implement/bugfix/review)
    if (payload.repo && payload.mode !== "plan") {
      await autoCommitAndPush(workDir, emitter, log);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ err }, "agent run failed");
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
  } finally {
    // Clean up workspace
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Inject auth token into clone URL for HTTPS authentication.
 */
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

/**
 * Auto-commit and push any remaining uncommitted changes after the agent finishes.
 */
async function autoCommitAndPush(
  workDir: string,
  emitter: AgentEventEmitter,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  // Check for uncommitted changes
  const status = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const statusOut = await new Response(status.stdout).text();
  await status.exited;

  if (!statusOut.trim()) return; // nothing to commit

  log.info("auto-committing remaining changes");

  // Stage + commit
  await Bun.spawn(["git", "add", "-A"], { cwd: workDir, stdout: "pipe", stderr: "pipe" }).exited;
  const commit = Bun.spawn(
    ["git", "commit", "-m", "chore: auto-commit remaining agent changes"],
    { cwd: workDir, stdout: "pipe", stderr: "pipe" },
  );
  await commit.exited;

  // Push
  const push = Bun.spawn(
    ["git", "push", "--set-upstream", "origin", "HEAD"],
    { cwd: workDir, stdout: "pipe", stderr: "pipe" },
  );
  const pushErr = await new Response(push.stderr).text();
  const pushCode = await push.exited;

  if (pushCode !== 0) {
    log.warn({ error: pushErr }, "auto-push failed (non-fatal)");
  }

  // Emit final diff
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
