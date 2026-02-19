/**
 * Edit tool — surgical text replacement with fuzzy matching and diff output.
 */

import type { AgentTool } from "@assembly-lime/pi-agent";
import { type Static, Type } from "@sinclair/typebox";
import type { EditOperations, EditToolDetails } from "../types.js";
import {
	detectLineEnding,
	fuzzyFindText,
	generateDiffString,
	normalizeForFuzzyMatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "../utils/edit-diff.js";
import { resolveToCwd } from "../utils/path-utils.js";

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolOptions {
	operations: EditOperations;
}

export function createEditTool(cwd: string, options: EditToolOptions): AgentTool<typeof editSchema> {
	const ops = options.operations;

	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: editSchema,
		execute: async (
			_toolCallId: string,
			{ path, oldText, newText }: { path: string; oldText: string; newText: string },
			signal?: AbortSignal,
		) => {
			const absolutePath = resolveToCwd(path, cwd);

			return new Promise<{
				content: Array<{ type: "text"; text: string }>;
				details: EditToolDetails | undefined;
			}>((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				let aborted = false;
				const onAbort = () => {
					aborted = true;
					reject(new Error("Operation aborted"));
				};
				if (signal) {
					signal.addEventListener("abort", onAbort, { once: true });
				}

				(async () => {
					try {
						try {
							await ops.access(absolutePath);
						} catch {
							if (signal) signal.removeEventListener("abort", onAbort);
							reject(new Error(`File not found: ${path}`));
							return;
						}

						if (aborted) return;

						const buffer = await ops.readFile(absolutePath);
						const rawContent = buffer.toString("utf-8");

						if (aborted) return;

						const { bom, text: content } = stripBom(rawContent);

						const originalEnding = detectLineEnding(content);
						const normalizedContent = normalizeToLF(content);
						const normalizedOldText = normalizeToLF(oldText);
						const normalizedNewText = normalizeToLF(newText);

						const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

						if (!matchResult.found) {
							if (signal) signal.removeEventListener("abort", onAbort);
							reject(
								new Error(
									`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
								),
							);
							return;
						}

						const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
						const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
						const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

						if (occurrences > 1) {
							if (signal) signal.removeEventListener("abort", onAbort);
							reject(
								new Error(
									`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
								),
							);
							return;
						}

						if (aborted) return;

						const baseContent = matchResult.contentForReplacement;
						const newContent =
							baseContent.substring(0, matchResult.index) +
							normalizedNewText +
							baseContent.substring(matchResult.index + matchResult.matchLength);

						if (baseContent === newContent) {
							if (signal) signal.removeEventListener("abort", onAbort);
							reject(
								new Error(
									`No changes made to ${path}. The replacement produced identical content.`,
								),
							);
							return;
						}

						const finalContent = bom + restoreLineEndings(newContent, originalEnding);
						await ops.writeFile(absolutePath, finalContent);

						if (aborted) return;
						if (signal) signal.removeEventListener("abort", onAbort);

						const diffResult = generateDiffString(baseContent, newContent);
						resolve({
							content: [
								{
									type: "text",
									text: `Successfully replaced text in ${path}.`,
								},
							],
							details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
						});
					} catch (error: any) {
						if (signal) signal.removeEventListener("abort", onAbort);
						if (!aborted) reject(error);
					}
				})();
			});
		},
	};
}
