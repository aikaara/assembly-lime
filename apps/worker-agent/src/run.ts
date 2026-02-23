import type { AgentJobPayload } from "@assembly-lime/shared";
import { DaytonaWorkspace, getDaytonaSandboxUrl, isGitHubAppConfigured, generateInstallationToken } from "@assembly-lime/shared";
import { logger } from "./lib/logger";
import { AgentEventEmitter } from "./agent/emitter";
import { createAgent } from "./agent/factory";
import { bridgeEvents } from "./agent/event-bridge";
import { buildToolSet } from "./tools/index";
import { buildSystemPrompt } from "./agent/system-prompt";
import { selectRepo } from "./agent/repo-selector";
import { createDaytonaOps } from "./ops/daytona-ops";
import type { GitOperations } from "./tools/git";
import type { PRContext } from "./tools/create-pr";

export type RunResult = {
  needsApproval: boolean;
  approvalMode?: "plan" | "code";
  approvalMessage?: string;
  workspace?: DaytonaWorkspace;
  prContext?: PRContext;
  previewUrl?: string;
};

/** Retry wrapper for transient API errors (429, 503, 529). */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.statusCode ?? err?.error?.status;
      const isTransient = status === 429 || status === 503 || status === 529;
      if (!isTransient || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function runUnifiedAgent(payload: AgentJobPayload): Promise<RunResult> {
  const log = logger.child({ runId: payload.runId, provider: payload.provider, mode: payload.mode });
  const emitter = new AgentEventEmitter(payload.runId);

  let workspace: DaytonaWorkspace | undefined;

  try {
    // 1. Resolve repo — LLM selection when multiple candidates, hard fail when none
    if (!payload.repo) {
      if (!payload.repos || payload.repos.length === 0) {
        throw new Error("repo is required — no repo provided and no candidate repos available");
      }
      const reposWithToken = payload.repos.filter(r => !!r.authToken).length;
      log.info({ candidateCount: payload.repos.length, reposWithAuthToken: reposWithToken }, "no primary repo, running LLM repo selection");
      await emitter.emitLog(`Selecting best repository from ${payload.repos.length} candidates...`);

      const { selected, reasoning } = await selectRepo(payload.repos, payload.inputPrompt, payload.mode);

      // selected.owner/name are guaranteed populated by selectRepo (derives from cloneUrl if needed)
      payload.repo = {
        repositoryId: selected.repositoryId,
        connectorId: selected.connectorId,
        owner: selected.owner,
        name: selected.name,
        cloneUrl: selected.cloneUrl,
        defaultBranch: selected.defaultBranch,
        authToken: selected.authToken,
      };

      await emitter.emitLog(`Selected repository: ${selected.fullName || `${selected.owner}/${selected.name}`} — ${reasoning}`);
    }

    // 2. Resolve auth token — prefer fresh GitHub App installation token
    let authToken = payload.repo.authToken;
    let tokenExpiresAt: Date | undefined;

    if (isGitHubAppConfigured()) {
      try {
        log.info({ repoOwner: payload.repo.owner }, "generating GitHub App installation token");
        const installToken = await generateInstallationToken(payload.repo.owner);
        authToken = installToken.token;
        tokenExpiresAt = installToken.expiresAt;
        log.info({ expiresAt: installToken.expiresAt, tokenLength: installToken.token.length }, "GitHub App installation token generated");
      } catch (err) {
        log.warn({ err }, "failed to generate GitHub App token, falling back to connector token");
      }
    }

    if (!authToken) {
      log.warn({ repoName: `${payload.repo.owner}/${payload.repo.name}`, connectorId: payload.repo.connectorId }, "no auth token for repo — clone will fail for private repos");
      await emitter.emitLog("Warning: no auth token available for this repository. If the repo is private, the clone will fail.");
    }

    // 3. Create Daytona sandbox (no clone yet)
    log.info({ repoName: `${payload.repo.owner}/${payload.repo.name}`, hasAuthToken: !!authToken }, "creating Daytona sandbox");
    workspace = await DaytonaWorkspace.createSandbox({
      runId: payload.runId,
      provider: payload.provider,
      mode: payload.mode,
      repoName: payload.repo.name,
      envVars: payload.sandbox?.envVars,
    });

    // Emit sandbox URL immediately + persist sandbox ID for reconnection
    const sandboxUrl = getDaytonaSandboxUrl(workspace.sandbox.id);
    await emitter.emit({
      type: "sandbox",
      sandboxId: workspace.sandbox.id,
      sandboxUrl,
      provider: "daytona",
    });
    await emitter.emitArtifact("sandbox", sandboxUrl, "text/html");
    await emitter.emitSandboxInfo(workspace.sandbox.id, workspace.repoDir);
    log.info({ sandboxId: workspace.sandbox.id }, "Daytona sandbox created");

    // Clone repo into sandbox with auth token
    await workspace.cloneRepo({
      cloneUrl: payload.repo.cloneUrl,
      defaultBranch: payload.repo.defaultBranch,
      ref: payload.repo.ref,
      authToken,
    });
    log.info({ repoName: `${payload.repo.owner}/${payload.repo.name}`, hasAuth: !!authToken }, "repo cloned into sandbox");

    // Create working branch
    const branchName = `al/${payload.mode}/${payload.runId}`;
    await workspace.createBranch(branchName);
    log.info({ branch: branchName }, "working branch created");

    // Inject env vars if provided
    const envVars = payload.sandbox?.envVars;
    if (envVars && Object.keys(envVars).length > 0) {
      await workspace.injectEnvVars(envVars);
    }

    // Clone additional repos (multi-repo support) — scoped by mode
    let additionalRepos: typeof payload.repos = [];
    if (payload.mode === "implement" || payload.mode === "bugfix") {
      // Only clone repos with a role label or isPrimary flag (max ~5 relevant repos, not 80+)
      additionalRepos = (payload.repos ?? [])
        .filter(r => r.repositoryId !== payload.repo!.repositoryId)
        .filter(r => r.roleLabel || r.isPrimary);
    }
    // plan/review mode: no additional repos — primary only

    for (const extra of additionalRepos) {
      const repoName = extra.cloneUrl.split("/").pop()?.replace(".git", "") ?? `repo-${extra.repositoryId}`;
      const cloneUrl = buildCloneUrl(extra.cloneUrl, extra.authToken ?? authToken);
      await workspace.exec(`git clone --depth 50 ${cloneUrl} /home/daytona/repos/${repoName}`);
      log.info({ repoName, repositoryId: extra.repositoryId }, "cloned additional repo into sandbox");
    }

    const ops = createDaytonaOps(workspace);
    const cwd = workspace.repoDir;

    const gitOps: GitOperations = {
      exec: async (args: string[]) => {
        return workspace!.exec(`git ${args.join(" ")}`);
      },
    };

    // 4. Build repo paths for system prompt (multi-repo context)
    const repoPaths: Array<{ name: string; path: string; primary: boolean }> = [];
    repoPaths.push({
      name: `${payload.repo.owner}/${payload.repo.name}`,
      path: cwd,
      primary: true,
    });
    for (const extra of additionalRepos) {
      const repoName = extra.cloneUrl.split("/").pop()?.replace(".git", "") ?? `repo-${extra.repositoryId}`;
      repoPaths.push({ name: repoName, path: `/home/daytona/repos/${repoName}`, primary: false });
    }

    // 5. Build PR context
    let prContext: PRContext | undefined;
    if (authToken) {
      prContext = {
        owner: payload.repo.owner,
        name: payload.repo.name,
        defaultBranch: payload.repo.defaultBranch,
        authToken,
      };
    }

    // 6. Build tools
    const { tools, toolRegistry } = buildToolSet(cwd, payload.mode, ops, gitOps, {
      prContext,
      emitter,
      workspace,
    });
    log.info({ toolCount: tools.length, mode: payload.mode }, "tools built");

    // 7. Build system prompt
    const systemPrompt = buildSystemPrompt({
      mode: payload.mode,
      resolvedPrompt: payload.resolvedPrompt,
      selectedTools: tools.map((t) => t.name),
      cwd,
      repos: repoPaths.length > 0 ? repoPaths : undefined,
    });

    // 8. Create agent (restore session if available)
    let initialMessages: any[] | undefined;
    const existingSession = await emitter.loadSessionSnapshot();
    if (existingSession && existingSession.length > 0) {
      log.info({ messageCount: existingSession.length }, "restoring agent session from DB");
      initialMessages = existingSession as any[];
    }

    const agent = createAgent({
      providerId: payload.provider,
      mode: payload.mode,
      systemPrompt,
      tools,
      emitter,
      initialMessages,
    });

    // 9. Bridge events with max-turns safety, checkpoints, and usage monitoring
    const timeBudgetSec = payload.constraints?.timeBudgetSec ?? 14400;
    const bridge = bridgeEvents(emitter, log, {
      maxTurns: 50,
      suppressTerminalStatus: true,
      checkpointInterval: 10,
      onMaxTurns: () => {
        agent.steer("You have used the maximum number of turns. Wrap up: commit any pending changes, summarize what you've done, and stop.");
      },
      onCheckpoint: (turnNumber) => {
        // Snapshot session every 10 turns
        emitter.emitSessionSnapshot(agent.state.messages).catch(() => {});
        log.info({ turnNumber, messageCount: agent.state.messages.length }, "periodic session checkpoint");

        // Usage monitoring: warn agent if approaching time budget
        try {
          const { usage } = require("@trigger.dev/sdk/v3");
          const current = usage.getCurrent();
          const elapsedSec = current?.attempt?.durationMs ? current.attempt.durationMs / 1000 : 0;
          if (elapsedSec > timeBudgetSec * 0.9) {
            agent.steer("You are approaching the time budget. Wrap up current work.");
            log.warn({ elapsedSec, timeBudgetSec }, "approaching time budget — steering agent to wrap up");
          }
        } catch { /* usage API may not be available outside Trigger.dev runtime */ }
      },
    });
    let unsubscribe = agent.subscribe(bridge.handler);

    // 10. Emit run repo tracking (before agent starts)
    const branchNameTracking = `al/${payload.mode}/${payload.runId}`;
    emitter.emitRunRepo({
      repositoryId: payload.repo.repositoryId,
      branch: branchNameTracking,
      status: "running",
    }).catch(() => {});

    // 11. Run the prompt or skip if this is a continuation (follow-up re-dispatch)
    if (payload.isContinuation && initialMessages && initialMessages.length > 0) {
      // Continuation: session was restored, skip initial prompt.
      // The follow-up loop below will pick up pending user messages from the DB.
      log.info({ messageCount: initialMessages.length }, "continuation mode — skipping initial prompt, going to follow-up loop");
    } else {
      log.info("starting agent prompt");

      // Start mid-prompt steering poller: check for user messages every 2s
      let steeringLastEventId = 0;
      const steeringPoller = setInterval(async () => {
        try {
          const msgs = await emitter.pollUserMessages(steeringLastEventId);
          if (msgs.length > 0) {
            steeringLastEventId = Math.max(...msgs.map((m) => m.id));
            const text = msgs.map((m) => m.text).join("\n\n");
            agent.steer(text);
            log.info({ messageCount: msgs.length }, "mid-prompt steering injected");
          }
        } catch { /* non-fatal */ }
      }, 2000);

      await withRetry(() => agent.prompt(payload.inputPrompt));
      await agent.waitForIdle();

      clearInterval(steeringPoller);

      unsubscribe();
      log.info({ totalTurns: bridge.getTurnNumber() }, "agent initial prompt completed");

      // Snapshot session after initial prompt
      await emitter.emitSessionSnapshot(agent.state.messages);
      log.info({ messageCount: agent.state.messages.length }, "session snapshot saved after initial prompt");
    }

    // ── Follow-up polling loop ──────────────────────────────────────
    // After initial prompt completes, enter a polling loop waiting for user messages.
    // Uses a short initial timeout (30s) when no follow-ups received.
    // Escalates to 15 min idle timeout after the first follow-up is processed.

    const FOLLOWUP_POLL_INTERVAL_MS = 1_000;
    const FOLLOWUP_INITIAL_IDLE_MS = 30_000; // 30s before any follow-up
    const FOLLOWUP_ACTIVE_IDLE_MS = 15 * 60 * 1_000; // 15 min after a follow-up
    const TRIGGER_BUDGET_RESERVE_MS = 120_000; // reserve 2 min for post-run
    const STATUS_CHECK_INTERVAL = 10; // check run status every 10 polls
    const runStartTime = Date.now();
    const timeBudgetMs = timeBudgetSec * 1000;
    let lastEventId = 0;
    // For continuations, messages are already pending — use the active (long) timeout
    let hasReceivedFollowUp = !!payload.isContinuation;

    await emitter.emitStatus("awaiting_followup", "Ready for follow-up messages.");
    let lastActivityTime = Date.now();
    let pollCount = 0;

    let exitReason = "idle_timeout";

    while (true) {
      // Check idle timeout — short if no follow-ups ever received, long otherwise
      const idleTimeout = hasReceivedFollowUp ? FOLLOWUP_ACTIVE_IDLE_MS : FOLLOWUP_INITIAL_IDLE_MS;
      if (Date.now() - lastActivityTime > idleTimeout) {
        exitReason = hasReceivedFollowUp ? "idle_timeout" : "no_followup";
        log.info({ idleMs: Date.now() - lastActivityTime, hasReceivedFollowUp }, "follow-up idle timeout reached");
        break;
      }

      // Check Trigger.dev budget
      const elapsed = Date.now() - runStartTime;
      if (elapsed + TRIGGER_BUDGET_RESERVE_MS > timeBudgetMs) {
        exitReason = "budget_exhausted";
        log.info({ elapsedMs: elapsed, budgetMs: timeBudgetMs }, "Trigger.dev budget nearly exhausted");
        break;
      }

      // Periodically check if run was cancelled externally
      pollCount++;
      if (pollCount % STATUS_CHECK_INTERVAL === 0) {
        const status = await emitter.pollRunStatus();
        if (status === "cancelled" || status === "failed") {
          exitReason = "cancelled_externally";
          log.info({ status }, "run cancelled externally, exiting follow-up loop");
          break;
        }
      }

      // Poll for user messages
      const messages = await emitter.pollUserMessages(lastEventId);

      if (messages.length > 0) {
        hasReceivedFollowUp = true;
        lastActivityTime = Date.now();
        const latestId = Math.max(...messages.map((m) => m.id));
        lastEventId = latestId;

        const combinedText = messages.map((m) => m.text).join("\n\n");
        log.info({ messageCount: messages.length, lastEventId }, "received follow-up message(s)");

        // Resume agent with follow-up
        await emitter.emitStatus("running", "Processing follow-up...");

        // Refresh token if needed before follow-up
        if (isGitHubAppConfigured() && tokenExpiresAt) {
          const minutesLeft = (tokenExpiresAt.getTime() - Date.now()) / 60_000;
          if (minutesLeft < 10) {
            try {
              const refreshed = await generateInstallationToken(payload.repo.owner);
              authToken = refreshed.token;
              tokenExpiresAt = refreshed.expiresAt;
              workspace.setAuthCredentials("x-access-token", refreshed.token);
              if (prContext) prContext.authToken = refreshed.token;
            } catch (err) {
              log.warn({ err }, "failed to refresh token during follow-up");
            }
          }
        }

        const followUpBridge = bridgeEvents(emitter, log, {
          maxTurns: 50,
          suppressTerminalStatus: true,
        });
        unsubscribe = agent.subscribe(followUpBridge.handler);

        try {
          // followUp() only enqueues the message — continue() triggers the LLM round
          agent.followUp(combinedText);
          await withRetry(() => agent.continue());
          await agent.waitForIdle();

          // Snapshot session after follow-up
          await emitter.emitSessionSnapshot(agent.state.messages);
          log.info({ messageCount: agent.state.messages.length }, "session snapshot saved after follow-up");
        } catch (err) {
          log.error({ err }, "error during follow-up");
          await emitter.emitError(
            err instanceof Error ? err.message : String(err),
          );
        }

        unsubscribe();
        await emitter.emitStatus("awaiting_followup", "Ready for follow-up messages.");
      }

      // Sleep before next poll
      await new Promise((resolve) => setTimeout(resolve, FOLLOWUP_POLL_INTERVAL_MS));
    }

    log.info({ exitReason, totalTurns: bridge.getTurnNumber() }, "exiting follow-up loop");

    // ── Post-run: commit + push + diff (implement/bugfix only) ──
    if (payload.mode === "plan") {
      // 12. Plan mode: return needsApproval for Trigger.dev wait.forToken()
      await emitter.emitStatus(
        "awaiting_approval",
        "Plan complete — review the created tasks and approve to begin implementation."
      );
      return {
        needsApproval: true,
        approvalMode: "plan",
        approvalMessage: "Plan complete — review the created tasks and approve to begin implementation.",
        workspace,
      };
    } else if (payload.mode === "implement" || payload.mode === "bugfix") {
      // 13. Refresh token if using GitHub App and token is near expiry (< 10 min left)
      if (isGitHubAppConfigured() && tokenExpiresAt) {
        const minutesLeft = (tokenExpiresAt.getTime() - Date.now()) / 60_000;
        if (minutesLeft < 10) {
          try {
            log.info({ minutesLeft: Math.round(minutesLeft) }, "refreshing GitHub App token before push");
            const refreshed = await generateInstallationToken(payload.repo.owner);
            authToken = refreshed.token;
            tokenExpiresAt = refreshed.expiresAt;
            workspace.setAuthCredentials("x-access-token", refreshed.token);
            if (prContext) prContext.authToken = refreshed.token;
          } catch (err) {
            log.warn({ err }, "failed to refresh GitHub App token (will use existing)");
          }
        }
      }
      await postRunDaytona(workspace, emitter, log, prContext, payload.runId, payload.mode, payload.repo);

      // 14. Preview (implement/bugfix modes)
      let previewUrl: string | undefined;
      try {
        const sessionId = `preview-${payload.runId}`;
        const devServer = await workspace.startDevServer(sessionId);
        if (devServer.previewUrl) {
          previewUrl = devServer.previewUrl;
          await emitter.emitArtifact("preview", devServer.previewUrl, "text/html");
          log.info({ previewUrl: devServer.previewUrl, port: devServer.port }, "preview started");
        }
      } catch (err) {
        log.warn({ err }, "failed to start dev server (non-fatal)");
      }

      // 15. Return needsApproval for Trigger.dev wait.forToken()
      const approvalMsg = previewUrl
        ? `Changes committed and pushed. Preview: ${previewUrl}. Approve to create PR.`
        : "Changes committed and pushed. Approve to create PR.";
      await emitter.emitStatus("awaiting_approval", approvalMsg);
      return {
        needsApproval: true,
        approvalMode: "code",
        approvalMessage: approvalMsg,
        workspace,
        prContext,
        previewUrl,
      };
    } else {
      // review mode: just complete — stop sandbox (no approval needed)
      await emitter.emitStatus("completed", "Agent run completed.");
      if (workspace) {
        try {
          log.info({ sandboxId: workspace.sandbox.id }, "stopping sandbox after review run");
          await workspace.stop();
        } catch (err) {
          log.warn({ err }, "failed to stop sandbox after review (non-fatal)");
        }
      }
      return { needsApproval: false };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ err }, "agent run failed");
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);

    // Stop sandbox on failure to free resources
    if (workspace) {
      try {
        log.info({ sandboxId: workspace.sandbox.id }, "stopping sandbox after failed run");
        await workspace.stop();
      } catch (stopErr) {
        log.warn({ stopErr }, "failed to stop sandbox after error (non-fatal)");
      }
    }

    return { needsApproval: false };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

type RepoPayload = NonNullable<AgentJobPayload["repo"]>;

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
  prContext: PRContext | undefined,
  runId: number,
  mode: string,
  repo: RepoPayload,
): Promise<void> {
  const branchName = `al/${mode}/${runId}`;

  const { stdout: status } = await workspace.exec("git status --porcelain");
  if (!status.trim()) {
    emitter.emitRunRepo({ repositoryId: repo.repositoryId, branch: branchName, status: "completed" }).catch(() => {});
    return;
  }

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
    emitter.emitCodeDiff({
      repositoryId: repo.repositoryId,
      baseRef: `origin/${defaultBranch}`,
      headRef: branchName,
      unifiedDiff: diff.trim(),
      summary: "Auto-committed remaining changes",
    }).catch(() => {});
  }

  emitter.emitRunRepo({
    repositoryId: repo.repositoryId,
    branch: branchName,
    status: "completed",
    diffSummary: diff.trim() ? `${diff.trim().split("\n").length} lines changed` : undefined,
  }).catch(() => {});
}
