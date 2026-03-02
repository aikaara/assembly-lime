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
import { createTasksTool } from "./create-tasks.js";
import { createUpdateTaskStatusTool } from "./update-task-status.js";
import { createSemanticSearchTool, createFindSimilarCodeTool, createFindUsagesTool } from "./semantic-search.js";
import type { AgentEventEmitter } from "../agent/emitter.js";
import type { DaytonaWorkspace } from "@assembly-lime/shared";

export interface BuildToolSetOptions {
	prContext?: PRContext;
	emitter?: AgentEventEmitter;
	workspace?: DaytonaWorkspace;
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
		case "plan": {
			tools = [bash, read, grep, find, ls, gitStatus, gitDiff];
			if (options.emitter) {
				const tasksTool = createTasksTool(options.emitter);
				registry.set(tasksTool.name, tasksTool);
				tools.push(tasksTool);
				const updateTaskStatusTool = createUpdateTaskStatusTool(options.emitter);
				registry.set(updateTaskStatusTool.name, updateTaskStatusTool);
				tools.push(updateTaskStatusTool);
				// Semantic search tools for plan mode
				const semSearch = createSemanticSearchTool(options.emitter);
				registry.set(semSearch.name, semSearch);
				tools.push(semSearch);
				const findUsages = createFindUsagesTool(options.emitter);
				registry.set(findUsages.name, findUsages);
				tools.push(findUsages);
			}
			break;
		}

		case "review":
			tools = [bash, read, grep, find, ls, gitStatus, gitDiff];
			if (options.emitter) {
				const semSearchReview = createSemanticSearchTool(options.emitter);
				registry.set(semSearchReview.name, semSearchReview);
				tools.push(semSearchReview);
				const findSimilarReview = createFindSimilarCodeTool(options.emitter);
				registry.set(findSimilarReview.name, findSimilarReview);
				tools.push(findSimilarReview);
			}
			break;

		case "bugfix":
			tools = [bash, read, write, edit, grep, find, ls, gitStatus, gitDiff, gitCommitPush];
			if (options.prContext) tools.push(registry.get("create_pr")!);
			if (options.emitter) {
				const semSearchBugfix = createSemanticSearchTool(options.emitter);
				registry.set(semSearchBugfix.name, semSearchBugfix);
				tools.push(semSearchBugfix);
				const findSimilarBugfix = createFindSimilarCodeTool(options.emitter);
				registry.set(findSimilarBugfix.name, findSimilarBugfix);
				tools.push(findSimilarBugfix);
				const findUsagesBugfix = createFindUsagesTool(options.emitter);
				registry.set(findUsagesBugfix.name, findUsagesBugfix);
				tools.push(findUsagesBugfix);
			}
			break;

		case "implement": {
			tools = [bash, read, write, edit, grep, find, ls, gitStatus, gitDiff, gitCommitPush];
			if (options.prContext) tools.push(registry.get("create_pr")!);
			if (options.emitter) {
				const updateTaskStatusTool = createUpdateTaskStatusTool(options.emitter);
				registry.set(updateTaskStatusTool.name, updateTaskStatusTool);
				tools.push(updateTaskStatusTool);
				// Semantic search tools for implement mode
				const semSearchImpl = createSemanticSearchTool(options.emitter);
				registry.set(semSearchImpl.name, semSearchImpl);
				tools.push(semSearchImpl);
				const findSimilarImpl = createFindSimilarCodeTool(options.emitter);
				registry.set(findSimilarImpl.name, findSimilarImpl);
				tools.push(findSimilarImpl);
				const findUsagesImpl = createFindUsagesTool(options.emitter);
				registry.set(findUsagesImpl.name, findUsagesImpl);
				tools.push(findUsagesImpl);
			}

			// Subagent tool (implement mode only) — uses all registered tools EXCEPT subagent itself
			const subagent = createSubagentTool({
				allTools: registry,
				cwd,
				workspace: options.workspace,
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
