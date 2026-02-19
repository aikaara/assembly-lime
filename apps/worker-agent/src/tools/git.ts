/**
 * Git tools — operations-aware git status, diff, commit+push.
 * Consolidated from git-status.ts, git-diff.ts, git-commit-push.ts.
 */

import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import { Type } from "@sinclair/typebox";

export interface GitOperations {
	exec: (args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

// ── git_status ────────────────────────────────────────────────────────

const statusParams = Type.Object({});

export function createGitStatusTool(cwd: string, gitOps: GitOperations): AgentTool<typeof statusParams> {
	return {
		name: "git_status",
		label: "git status",
		description: "Show the working tree status (modified, staged, untracked files).",
		parameters: statusParams,
		async execute(): Promise<AgentToolResult<undefined>> {
			const result = await gitOps.exec(["status", "--porcelain"]);
			const output = result.stdout.trim() || "(clean working tree)";
			return { content: [{ type: "text", text: output }], details: undefined };
		},
	};
}

// ── git_diff ──────────────────────────────────────────────────────────

const diffParams = Type.Object({
	staged: Type.Optional(Type.Boolean({ description: "Show staged changes only (default: false)" })),
	path: Type.Optional(Type.String({ description: "Limit diff to a specific path" })),
});

export function createGitDiffTool(cwd: string, gitOps: GitOperations): AgentTool<typeof diffParams> {
	return {
		name: "git_diff",
		label: "git diff",
		description: "Show unified diff of changes. Use staged=true for staged changes only.",
		parameters: diffParams,
		async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
			const args = ["diff"];
			if (params.staged) args.push("--cached");
			if (params.path) args.push("--", params.path);

			const result = await gitOps.exec(args);
			const output = result.stdout.trim() || "(no changes)";
			return { content: [{ type: "text", text: output }], details: undefined };
		},
	};
}

// ── git_commit_push ───────────────────────────────────────────────────

const commitPushParams = Type.Object({
	message: Type.String({ description: "Commit message" }),
	push: Type.Optional(Type.Boolean({ description: "Push after committing (default: true)" })),
});

export function createGitCommitPushTool(cwd: string, gitOps: GitOperations): AgentTool<typeof commitPushParams> {
	return {
		name: "git_commit_push",
		label: "git commit & push",
		description: "Stage all changes, commit with the given message, and optionally push to the remote.",
		parameters: commitPushParams,
		async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
			const shouldPush = params.push !== false;
			const output: string[] = [];

			// Stage
			const addResult = await gitOps.exec(["add", "-A"]);
			if (addResult.exitCode !== 0) {
				throw new Error(`git add failed: ${addResult.stdout}`);
			}

			// Check if there's anything to commit
			const statusResult = await gitOps.exec(["status", "--porcelain"]);
			if (!statusResult.stdout.trim()) {
				return {
					content: [{ type: "text", text: "Nothing to commit (working tree clean)" }],
					details: undefined,
				};
			}

			// Commit
			const commitResult = await gitOps.exec(["commit", "-m", params.message]);
			if (commitResult.exitCode !== 0) {
				throw new Error(`git commit failed: ${commitResult.stdout}`);
			}
			output.push(`Committed: ${params.message}`);

			// Push
			if (shouldPush) {
				const pushResult = await gitOps.exec(["push", "--set-upstream", "origin", "HEAD"]);
				if (pushResult.exitCode !== 0) {
					output.push(`Push failed (non-fatal): ${pushResult.stdout}`);
				} else {
					output.push("Pushed to remote.");
				}
			}

			return {
				content: [{ type: "text", text: output.join("\n") }],
				details: undefined,
			};
		},
	};
}
