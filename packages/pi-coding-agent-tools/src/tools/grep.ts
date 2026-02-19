/**
 * Grep tool — search file contents for patterns.
 * Uses an exec-based operations interface (runs rg/grep via shell).
 */

import type { AgentTool } from "@assembly-lime/pi-agent";
import { type Static, Type } from "@sinclair/typebox";
import path from "path";
import type { GrepOperations, GrepToolDetails } from "../types.js";
import { resolveToCwd } from "../utils/path-utils.js";
import { DEFAULT_MAX_BYTES, formatSize, GREP_MAX_LINE_LENGTH, truncateHead, truncateLine } from "../utils/truncate.js";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

export type GrepToolInput = Static<typeof grepSchema>;

const DEFAULT_LIMIT = 100;

export interface GrepToolOptions {
	operations: GrepOperations;
}

export function createGrepTool(cwd: string, options: GrepToolOptions): AgentTool<typeof grepSchema> {
	const ops = options.operations;

	return {
		name: "grep",
		label: "grep",
		description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		parameters: grepSchema,
		execute: async (
			_toolCallId: string,
			{
				pattern,
				path: searchDir,
				glob: globPattern,
				ignoreCase,
				literal,
				context,
				limit,
			}: {
				pattern: string;
				path?: string;
				glob?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			},
			signal?: AbortSignal,
		) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const searchPath = resolveToCwd(searchDir || ".", cwd);
			const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
			const contextValue = context && context > 0 ? context : 0;

			// Build rg command (fall back to grep -rn if rg not available)
			const args: string[] = ["rg", "--json", "--line-number", "--color=never", "--hidden"];
			if (ignoreCase) args.push("--ignore-case");
			if (literal) args.push("--fixed-strings");
			if (globPattern) args.push("--glob", `'${globPattern}'`);
			args.push(`'${pattern.replace(/'/g, "'\\''")}'`, `'${searchPath}'`);

			const command = args.join(" ");
			let result: { stdout: string; exitCode: number };

			try {
				result = await ops.exec(command, cwd);
			} catch {
				// rg not available, fall back to grep
				const grepArgs: string[] = ["grep", "-rn", "--color=never"];
				if (ignoreCase) grepArgs.push("-i");
				if (literal) grepArgs.push("-F");
				if (globPattern) grepArgs.push(`--include='${globPattern}'`);
				grepArgs.push(`'${pattern.replace(/'/g, "'\\''")}'`, `'${searchPath}'`);
				result = await ops.exec(grepArgs.join(" "), cwd);
			}

			const stdout = result.stdout;

			// Try parsing as rg JSON output first
			const lines = stdout.split("\n").filter((l) => l.trim());
			let matches: Array<{ filePath: string; lineNumber: number }> = [];
			let isJsonOutput = false;

			for (const line of lines) {
				if (matches.length >= effectiveLimit) break;
				try {
					const event = JSON.parse(line);
					if (event.type === "match") {
						isJsonOutput = true;
						const filePath = event.data?.path?.text;
						const lineNumber = event.data?.line_number;
						if (filePath && typeof lineNumber === "number") {
							matches.push({ filePath, lineNumber });
						}
					}
				} catch {
					// Not JSON — must be plain grep output
					break;
				}
			}

			// If not JSON, parse plain grep output (file:line:content)
			if (!isJsonOutput && stdout.trim()) {
				matches = [];
				for (const line of lines) {
					if (matches.length >= effectiveLimit) break;
					const match = line.match(/^(.+?):(\d+):/);
					if (match) {
						matches.push({ filePath: match[1], lineNumber: parseInt(match[2], 10) });
					}
				}
			}

			if (matches.length === 0) {
				return { content: [{ type: "text", text: "No matches found" }], details: undefined };
			}

			// Build output with context
			const fileCache = new Map<string, string[]>();
			const getFileLines = async (filePath: string): Promise<string[]> => {
				let cached = fileCache.get(filePath);
				if (!cached) {
					try {
						const content = await ops.readFile(filePath);
						cached = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
					} catch {
						cached = [];
					}
					fileCache.set(filePath, cached);
				}
				return cached;
			};

			const formatPath = (filePath: string): string => {
				const relative = path.relative(searchPath, filePath);
				if (relative && !relative.startsWith("..")) {
					return relative.replace(/\\/g, "/");
				}
				return path.basename(filePath);
			};

			const outputLines: string[] = [];
			let linesTruncated = false;

			for (const match of matches) {
				const relativePath = formatPath(match.filePath);
				const fileLines = await getFileLines(match.filePath);

				if (!fileLines.length) {
					outputLines.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
					continue;
				}

				const start = contextValue > 0 ? Math.max(1, match.lineNumber - contextValue) : match.lineNumber;
				const end = contextValue > 0 ? Math.min(fileLines.length, match.lineNumber + contextValue) : match.lineNumber;

				for (let current = start; current <= end; current++) {
					const lineText = fileLines[current - 1] ?? "";
					const sanitized = lineText.replace(/\r/g, "");
					const isMatchLine = current === match.lineNumber;

					const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) linesTruncated = true;

					if (isMatchLine) {
						outputLines.push(`${relativePath}:${current}: ${truncatedText}`);
					} else {
						outputLines.push(`${relativePath}-${current}- ${truncatedText}`);
					}
				}
			}

			const rawOutput = outputLines.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			let output = truncation.content;
			const details: GrepToolDetails = {};
			const notices: string[] = [];

			const matchLimitReached = matches.length >= effectiveLimit;
			if (matchLimitReached) {
				notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
				details.matchLimitReached = effectiveLimit;
			}

			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}

			if (linesTruncated) {
				notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
				details.linesTruncated = true;
			}

			if (notices.length > 0) {
				output += `\n\n[${notices.join(". ")}]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
	};
}
