/**
 * System prompt builder for the unified agent worker.
 * Adapted from pi-coding-agent's system-prompt.ts for server context.
 */

import type { AgentMode } from "@assembly-lime/shared";

/** Tool descriptions for system prompt */
const toolDescriptions: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands",
	edit: "Make surgical edits to files (find exact text and replace)",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
	git_status: "Show git working tree status",
	git_diff: "Show git diff (staged and unstaged)",
	git_commit_push: "Stage, commit, and push changes",
	create_pr: "Create a GitHub pull request",
	subagent: "Spawn specialized sub-agents for complex tasks",
	create_tasks: "Create implementation tasks as tickets on the project board",
};

export interface BuildSystemPromptOptions {
	mode: AgentMode;
	resolvedPrompt?: string;
	selectedTools: string[];
	cwd: string;
	repos?: Array<{ name: string; path: string; primary: boolean }>;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const { mode, resolvedPrompt, selectedTools, cwd, repos } = options;

	const now = new Date();
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});

	// Build tools list
	const tools = selectedTools.filter((t) => t in toolDescriptions);
	const toolsList = tools.length > 0
		? tools.map((t) => `- ${t}: ${toolDescriptions[t]}`).join("\n")
		: "(none)";

	// Build guidelines based on mode and available tools
	const guidelines: string[] = [];

	const hasBash = tools.includes("bash");
	const hasEdit = tools.includes("edit");
	const hasWrite = tools.includes("write");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	if (hasBash && (hasGrep || hasFind || hasLs)) {
		guidelines.push("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	if (hasRead && hasEdit) {
		guidelines.push("Use read to examine files before editing. Do not use cat or sed.");
	}

	if (hasEdit) {
		guidelines.push("Use edit for precise changes (old text must match exactly)");
	}

	if (hasWrite) {
		guidelines.push("Use write only for new files or complete rewrites");
	}

	if (hasEdit || hasWrite) {
		guidelines.push("When summarizing your actions, output plain text directly — do NOT use bash to display what you did");
	}

	guidelines.push("Be concise in your responses");
	guidelines.push("Show file paths clearly when working with files");

	// Mode-specific preamble
	const modePreamble = getModePreamble(mode);

	const guidelinesText = guidelines.map((g) => `- ${g}`).join("\n");

	let prompt = `${modePreamble}

# Available Tools

${toolsList}

# Guidelines

${guidelinesText}

Current date and time: ${dateTime}
Current working directory: ${cwd}`;

	// Multi-repo context
	if (repos && repos.length > 1) {
		const repoLines = repos.map((r) => {
			const tag = r.primary ? "PRIMARY" : "       ";
			return `- ${tag}: ${r.name} at ${r.path}${r.primary ? " (this is your working directory)" : ""}`;
		});
		prompt += `

# Repository Layout

You have access to the following repositories:
${repoLines.join("\n")}

When making changes that span multiple repositories, work on one repo at a time. Use \`cd\` or absolute paths to switch between repos.`;
	}

	// Append resolved prompt (instruction resolution chain from API)
	if (resolvedPrompt) {
		prompt += `\n\n# Project Instructions\n\n${resolvedPrompt}`;
	}

	return prompt;
}

function getModePreamble(mode: AgentMode): string {
	switch (mode) {
		case "plan":
			return `You are a planning agent. Your job is to explore the codebase, understand the architecture, and break down the user's request into concrete implementation tasks.

Approach:
1. First, explore the project structure (package.json, directory layout, key config files)
2. Identify the relevant files and components for the user's request
3. Analyze dependencies and potential risks
4. Break the work down into specific, actionable subtasks — each should be independently implementable
5. Use the create_tasks tool to create tickets for each subtask on the project board
6. Summarize the plan and list the created tasks

Do NOT make any code changes — only read and analyze. Your final output should always include tasks created via the create_tasks tool. Each task title should be imperative and specific (e.g. "Add email validation to signup endpoint"). Include enough detail in the description for another developer (or agent) to implement it without ambiguity.`;

		case "implement":
			return `You are a coding agent. Implement the requested changes step by step.

Approach:
1. Understand the request — read relevant files first
2. Plan your changes before editing
3. Make changes incrementally — edit one file at a time, verify after each change
4. Run tests if available (look for test scripts in package.json)
5. Commit and push your work when done

When working on a large task, break it into numbered steps and report progress as you complete each one.`;

		case "bugfix":
			return `You are a debugging agent. Find and fix the reported issue.

Approach:
1. Reproduce — understand the symptoms and find relevant code
2. Diagnose — read the code, check logs, identify root cause
3. Fix — make the minimal change needed
4. Verify — run tests or check the fix manually
5. Commit and push when the fix is verified`;

		case "review":
			return `You are a code review agent. Examine the code for bugs, security issues, performance problems, and style concerns. Provide constructive feedback with specific file/line references.`;

		default:
			return `You are a coding agent. Help the user with their request.`;
	}
}
