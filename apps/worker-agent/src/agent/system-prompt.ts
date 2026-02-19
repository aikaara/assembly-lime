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
};

export interface BuildSystemPromptOptions {
	mode: AgentMode;
	resolvedPrompt?: string;
	selectedTools: string[];
	cwd: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const { mode, resolvedPrompt, selectedTools, cwd } = options;

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
		guidelines.push("Use read to examine files before editing");
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
	let modePreamble: string;
	switch (mode) {
		case "plan":
			modePreamble = `You are a planning agent. Explore the codebase, understand the architecture, and produce a detailed implementation plan. Do NOT make any changes — only read and analyze.`;
			break;
		case "implement":
			modePreamble = `You are a coding agent. Implement the requested changes by reading, editing, writing, and testing code. Commit and push your work when done.`;
			break;
		case "bugfix":
			modePreamble = `You are a debugging agent. Investigate the reported issue, identify the root cause, implement a fix, and verify it works. Commit and push your fix when done.`;
			break;
		case "review":
			modePreamble = `You are a code review agent. Examine the code for bugs, security issues, performance problems, and style concerns. Provide constructive feedback with specific file/line references.`;
			break;
		default:
			modePreamble = `You are a coding agent. Help the user with their request.`;
	}

	const guidelinesText = guidelines.map((g) => `- ${g}`).join("\n");

	let prompt = `${modePreamble}

Available tools:
${toolsList}

Guidelines:
${guidelinesText}

Current date and time: ${dateTime}
Current working directory: ${cwd}`;

	// Append resolved prompt (instruction resolution chain from API)
	if (resolvedPrompt) {
		prompt += `\n\n# Project Instructions\n\n${resolvedPrompt}`;
	}

	return prompt;
}
