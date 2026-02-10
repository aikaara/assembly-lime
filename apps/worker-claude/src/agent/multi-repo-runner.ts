import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { runClaudeAgent } from "./claude-runner";
import { logger } from "../lib/logger";

export async function runClaudeAgentMultiRepo(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
) {
  const repos = payload.repos;
  if (!repos || repos.length === 0) {
    await emitter.emit({
      type: "error",
      message: "No repositories specified for multi-repo run",
    });
    return;
  }

  const log = logger.child({ runId: payload.runId });
  log.info({ repoCount: repos.length }, "starting multi-repo run");

  await emitter.emit({
    type: "message",
    role: "system",
    text: `Starting multi-repo run across ${repos.length} repositories`,
  });

  for (const repo of repos) {
    await emitter.emit({
      type: "log",
      text: `Processing repository: ${repo.cloneUrl} (branch: ${repo.ref ?? repo.defaultBranch})`,
    });

    const repoPayload: AgentJobPayload = {
      ...payload,
      repo: {
        repositoryId: repo.repositoryId,
        connectorId: 0,
        owner: "",
        name: "",
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
        ref: repo.ref,
      },
      repos: undefined,
    };

    try {
      await runClaudeAgent(repoPayload, emitter);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, repositoryId: repo.repositoryId }, "multi-repo run failed for repo");
      await emitter.emit({
        type: "error",
        message: `Failed for repository ${repo.cloneUrl}: ${message}`,
      });
    }
  }

  await emitter.emit({
    type: "message",
    role: "system",
    text: `Multi-repo run completed across ${repos.length} repositories`,
  });
}
