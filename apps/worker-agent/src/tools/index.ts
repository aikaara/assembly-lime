import type { AgentTool } from "@assembly-lime/pi-agent";
import type { AgentMode } from "@assembly-lime/shared";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";
import { createListFilesTool } from "./list-files";
import { createSearchCodeTool } from "./search-code";
import { createRunCommandTool } from "./run-command";
import { createGitStatusTool } from "./git-status";
import { createGitDiffTool } from "./git-diff";
import { createGitCommitPushTool } from "./git-commit-push";
import { createPRTool, type PRContext } from "./create-pr";

/**
 * Build the tool set based on agent mode.
 * - plan: read-only tools only
 * - implement/bugfix/review: all tools including write + git push + PR
 */
export function buildTools(
  workDir: string,
  mode: AgentMode,
  prContext?: PRContext,
): AgentTool<any>[] {
  // Read-only tools available in all modes
  const readOnlyTools: AgentTool<any>[] = [
    createReadFileTool(workDir),
    createListFilesTool(workDir),
    createSearchCodeTool(workDir),
    createGitStatusTool(workDir),
    createGitDiffTool(workDir),
  ];

  if (mode === "plan") {
    return readOnlyTools;
  }

  // Write tools for implement/bugfix/review
  const writeTools: AgentTool<any>[] = [
    createWriteFileTool(workDir),
    createRunCommandTool(workDir),
    createGitCommitPushTool(workDir),
  ];

  if (prContext) {
    writeTools.push(createPRTool(workDir, prContext));
  }

  return [...readOnlyTools, ...writeTools];
}
