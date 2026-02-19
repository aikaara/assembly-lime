/**
 * Find tool — search for files by glob pattern.
 * Uses an exec-based operations interface (runs fd/find via shell).
 */

import type { AgentTool } from "@assembly-lime/pi-agent";
import { type Static, Type } from "@sinclair/typebox";
import path from "path";
import type { FindOperations, FindToolDetails } from "../types.js";
import { resolveToCwd } from "../utils/path-utils.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "../utils/truncate.js";

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;

export interface FindToolOptions {
	operations: FindOperations;
}

export function createFindTool(cwd: string, options: FindToolOptions): AgentTool<typeof findSchema> {
	const ops = options.operations;

	return {
		name: "find",
		label: "find",
		description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		parameters: findSchema,
		execute: async (
			_toolCallId: string,
			{ pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
			signal?: AbortSignal,
		) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const searchPath = resolveToCwd(searchDir || ".", cwd);
			const effectiveLimit = limit ?? DEFAULT_LIMIT;

			// Try fd first (fast, respects .gitignore)
			const fdCommand = `fd --glob --color=never --hidden --max-results ${effectiveLimit} '${pattern.replace(/'/g, "'\\''")}'  '${searchPath}'`;

			let result: { stdout: string; exitCode: number };
			try {
				result = await ops.exec(fdCommand, cwd);
			} catch {
				// Fall back to find
				const findCommand = `find '${searchPath}' -name '${pattern.replace(/'/g, "'\\''")}'  -not -path '*/node_modules/*' -not -path '*/.git/*' | head -n ${effectiveLimit}`;
				result = await ops.exec(findCommand, cwd);
			}

			const output = result.stdout?.trim() || "";

			if (!output) {
				return {
					content: [{ type: "text", text: "No files found matching pattern" }],
					details: undefined,
				};
			}

			const rawLines = output.split("\n");
			const relativized: string[] = [];

			for (const rawLine of rawLines) {
				const line = rawLine.replace(/\r$/, "").trim();
				if (!line) continue;

				const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
				let relativePath = line;
				if (line.startsWith(searchPath)) {
					relativePath = line.slice(searchPath.length + 1);
				} else {
					relativePath = path.relative(searchPath, line);
				}

				if (hadTrailingSlash && !relativePath.endsWith("/")) {
					relativePath += "/";
				}

				relativized.push(relativePath);
			}

			if (relativized.length === 0) {
				return {
					content: [{ type: "text", text: "No files found matching pattern" }],
					details: undefined,
				};
			}

			const resultLimitReached = relativized.length >= effectiveLimit;
			const rawOutput = relativized.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			let resultOutput = truncation.content;
			const details: FindToolDetails = {};
			const notices: string[] = [];

			if (resultLimitReached) {
				notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
				details.resultLimitReached = effectiveLimit;
			}

			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}

			if (notices.length > 0) {
				resultOutput += `\n\n[${notices.join(". ")}]`;
			}

			return {
				content: [{ type: "text", text: resultOutput }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
	};
}
