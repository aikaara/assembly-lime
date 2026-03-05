/**
 * System prompt builder for the unified agent worker.
 *
 * NOTE: The `resolvedPrompt` field (from the API) already contains:
 *   provider preamble + mode prompt + instruction layers + user prompt
 * (via packages/shared/src/prompts/index.ts → resolvePrompt()).
 *
 * This builder adds runtime context that only the worker knows:
 *   tools, working directory, repo layout, pre-run RAG context.
 */

import type { AgentMode } from "@assembly-lime/shared";

const toolDescriptions: Record<string, string> = {
	read: "Read file contents (prefer over cat/head/tail)",
	bash: "Execute shell commands in the sandbox",
	edit: "Surgical text replacement — old_string must match exactly",
	write: "Create new files or complete rewrites (read first if file exists)",
	grep: "Search file contents with regex (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
	git_status: "Show git working tree status",
	git_diff: "Show staged + unstaged diffs",
	git_commit_push: "Stage all, commit, and push",
	create_pr: "Create a GitHub pull request from the working branch",
	subagent: "Spawn a sub-agent for parallel or isolated work",
	create_tasks: "Create implementation tickets on the project board",
	update_task_status: "Mark a task as in_progress or completed",
	semantic_search: "Natural-language search across all indexed repos",
	find_similar_code: "Find structurally similar code to a given snippet",
	find_usages: "Find where a symbol is used across all repositories",
};

export interface BuildSystemPromptOptions {
	mode: AgentMode;
	resolvedPrompt?: string;
	selectedTools: string[];
	cwd: string;
	repos?: Array<{ name: string; path: string; primary: boolean }>;
	preRunContext?: string;
	isContinuation?: boolean;
	workingBranch?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const { mode, resolvedPrompt, selectedTools, cwd, repos, preRunContext, isContinuation, workingBranch } = options;

	const now = new Date();
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});

	// Available tools
	const tools = selectedTools.filter((t) => t in toolDescriptions);
	const toolsList = tools.length > 0
		? tools.map((t) => `- **${t}** — ${toolDescriptions[t]}`).join("\n")
		: "(none)";

	// Mode-specific operational rules (NOT the full mode prompt — that's in resolvedPrompt)
	const operationalRules = getOperationalRules(mode, tools);

	const parts: string[] = [];

	// Resolved prompt already contains: preamble + mode prompt + instruction layers + user prompt
	if (resolvedPrompt) {
		parts.push(resolvedPrompt);
	}

	// Pre-run RAG context
	if (preRunContext) {
		parts.push(`# Relevant Code Context

The following code was found relevant via org-wide semantic search. Use as starting context — run semantic_search / find_similar_code / find_usages for deeper lookups.

${preRunContext}`);
	}

	// Runtime environment
	parts.push(`# Environment

- **Date:** ${dateTime}
- **Working directory:** ${cwd}
- **Mode:** ${mode}${workingBranch ? `\n- **Branch:** ${workingBranch}` : ""}`);

	// Continuation context
	if (isContinuation) {
		parts.push(`# Continuation

This is a **follow-up session**. Your conversation history has been restored from the previous run. The user has sent a new message — read it and continue where you left off.${workingBranch ? `\n\nYou are on branch \`${workingBranch}\` which contains your previous changes. Run \`git log --oneline -5\` to see what was done.` : ""}`);
	}

	// Multi-repo layout
	if (repos && repos.length > 1) {
		const repoLines = repos.map((r) => {
			return r.primary
				? `- **${r.name}** → \`${r.path}\` (primary, this is your cwd)`
				: `- ${r.name} → \`${r.path}\``;
		});
		parts.push(`# Repository Layout

${repoLines.join("\n")}

Work on one repo at a time. Use absolute paths or \`cd\` to switch.`);
	}

	// Tools
	parts.push(`# Available Tools

${toolsList}`);

	// Operational rules
	if (operationalRules.length > 0) {
		parts.push(`# Rules

${operationalRules.map((r) => `- ${r}`).join("\n")}`);
	}

	return parts.join("\n\n---\n\n");
}

function getOperationalRules(mode: AgentMode, tools: string[]): string[] {
	const rules: string[] = [];

	// Tool usage rules
	const hasBash = tools.includes("bash");
	const hasRead = tools.includes("read");
	const hasEdit = tools.includes("edit");
	const hasWrite = tools.includes("write");

	if (hasRead) {
		rules.push("Always read a file before editing it. Never guess at file contents.");
	}
	if (hasBash) {
		rules.push("Prefer dedicated tools (read/edit/grep/find/ls) over bash equivalents. Use bash for build commands, test runners, and system operations.");
	}
	if (hasEdit) {
		rules.push("Use edit for targeted changes — old_string must match the file exactly (whitespace-sensitive).");
	}
	if (hasWrite) {
		rules.push("Use write only for new files or complete rewrites. Prefer edit for modifications.");
	}

	// Mode-specific operational guidance
	switch (mode) {
		case "plan":
			rules.push(
				"Do NOT modify any files. Read-only exploration.",
				"Create tasks via create_tasks — each title should be imperative and specific.",
				"Include codeContext (file paths, symbols, line ranges) in each task so implementing agents can jump straight to relevant code.",
				"Update task status as you analyze: in_progress when discussing, completed when fully analyzed.",
			);
			break;
		case "implement":
			rules.push(
				"Make changes incrementally — one logical change at a time, verify after each.",
				"Run tests if available (check package.json scripts).",
				"Update task status: in_progress when starting, completed when done.",
				"Commit and push when finished.",
			);
			break;
		case "bugfix":
			rules.push(
				"Reproduce → Diagnose → Fix → Verify. Minimal changes only.",
				"Explain the root cause before fixing.",
				"Run tests to verify the fix doesn't regress.",
				"Commit and push when the fix is verified.",
			);
			break;
		case "review":
			rules.push(
				"Do NOT modify any files. Read-only review.",
				"Reference specific files and line numbers.",
				"Categorize findings: critical / warning / suggestion.",
				"Check for: bugs, security issues, performance problems, missing error handling.",
			);
			break;
	}

	rules.push("Be concise. Show file paths when working with files.");

	return rules;
}
