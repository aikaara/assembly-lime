/**
 * Tool registry — builds tool sets from vendored pi-coding-agent-tools.
 *
 * Tools by mode:
 *   plan:      [bash, read, grep, find, ls, git_status, git_diff]
 *   implement: [bash, read, write, edit, grep, find, ls, git_status, git_diff, git_commit_push, create_pr, subagent]
 *   bugfix:    [bash, read, write, edit, grep, find, ls, git_status, git_diff, git_commit_push, create_pr]
 *   review:    [bash, read, grep, find, ls, git_status, git_diff]
 */

import type { AgentTool } from "@assembly-lime/pi-agent";
import type { AgentMode } from "@assembly-lime/shared";
import type { OperationsBundle } from "@assembly-lime/pi-coding-agent-tools";
import {
	createBashTool,
	createReadTool,
	createWriteTool,
	createEditTool,
	createGrepTool,
	createFindTool,
	createLsTool,
} from "@assembly-lime/pi-coding-agent-tools";
import {
	createGitStatusTool,
	createGitDiffTool,
	createGitCommitPushTool,
	type GitOperations,
} from "./git.js";
import { createPRTool, type PRContext } from "./create-pr.js";
import { createSubagentTool } from "./subagent.js";
import type { AgentEventEmitter } from "../agent/emitter.js";

export interface BuildToolSetOptions {
	prContext?: PRContext;
	emitter?: AgentEventEmitter;
}

export interface BuildToolSetResult {
	tools: AgentTool<any>[];
	toolRegistry: Map<string, AgentTool<any>>;
}

export function buildToolSet(
	cwd: string,
	mode: AgentMode,
	ops: OperationsBundle,
	gitOps: GitOperations,
	options: BuildToolSetOptions = {},
): BuildToolSetResult {
	const registry = new Map<string, AgentTool<any>>();

	// Core tools (from vendored pi-coding-agent-tools)
	const bash = createBashTool(cwd, { operations: ops.bash });
	const read = createReadTool(cwd, { operations: ops.read });
	const write = createWriteTool(cwd, { operations: ops.write });
	const edit = createEditTool(cwd, { operations: ops.edit });
	const grep = createGrepTool(cwd, { operations: ops.grep });
	const find = createFindTool(cwd, { operations: ops.find });
	const ls = createLsTool(cwd, { operations: ops.ls });

	// Git tools
	const gitStatus = createGitStatusTool(cwd, gitOps);
	const gitDiff = createGitDiffTool(cwd, gitOps);
	const gitCommitPush = createGitCommitPushTool(cwd, gitOps);

	// Register all
	for (const tool of [bash, read, write, edit, grep, find, ls, gitStatus, gitDiff, gitCommitPush]) {
		registry.set(tool.name, tool);
	}

	// PR tool
	if (options.prContext) {
		const prTool = createPRTool(cwd, options.prContext);
		registry.set(prTool.name, prTool);
	}

	// Build mode-specific tool list
	let tools: AgentTool<any>[];

	switch (mode) {
		case "plan":
			tools = [bash, read, grep, find, ls, gitStatus, gitDiff];
			break;

		case "review":
			tools = [bash, read, grep, find, ls, gitStatus, gitDiff];
			break;

		case "bugfix":
			tools = [bash, read, write, edit, grep, find, ls, gitStatus, gitDiff, gitCommitPush];
			if (options.prContext) tools.push(registry.get("create_pr")!);
			break;

		case "implement": {
			tools = [bash, read, write, edit, grep, find, ls, gitStatus, gitDiff, gitCommitPush];
			if (options.prContext) tools.push(registry.get("create_pr")!);

			// Subagent tool (implement mode only) — uses all registered tools EXCEPT subagent itself
			const subagent = createSubagentTool({
				allTools: registry,
				cwd,
				onProgress: options.emitter
					? (agentName, message) => {
							options.emitter!.emitLog(message).catch(() => {});
						}
					: undefined,
			});
			registry.set(subagent.name, subagent);
			tools.push(subagent);
			break;
		}

		default:
			tools = [bash, read, grep, find, ls, gitStatus, gitDiff];
	}

	return { tools, toolRegistry: registry };
}
