// Types
export type {
	OperationsBundle,
	BashOperations,
	BashToolDetails,
	ReadOperations,
	ReadToolDetails,
	WriteOperations,
	EditOperations,
	EditToolDetails,
	GrepOperations,
	GrepToolDetails,
	FindOperations,
	FindToolDetails,
	LsOperations,
	LsToolDetails,
} from "./types.js";

// Tool factories
export { createBashTool, type BashToolInput, type BashToolOptions } from "./tools/bash.js";
export { createReadTool, type ReadToolInput, type ReadToolOptions } from "./tools/read.js";
export { createWriteTool, type WriteToolInput, type WriteToolOptions } from "./tools/write.js";
export { createEditTool, type EditToolInput, type EditToolOptions } from "./tools/edit.js";
export { createGrepTool, type GrepToolInput, type GrepToolOptions } from "./tools/grep.js";
export { createFindTool, type FindToolInput, type FindToolOptions } from "./tools/find.js";
export { createLsTool, type LsToolInput, type LsToolOptions } from "./tools/ls.js";

// Utilities
export {
	DEFAULT_MAX_LINES,
	DEFAULT_MAX_BYTES,
	GREP_MAX_LINE_LENGTH,
	formatSize,
	truncateHead,
	truncateTail,
	truncateLine,
	type TruncationResult,
	type TruncationOptions,
} from "./utils/truncate.js";

export { expandPath, resolveToCwd, resolveReadPath } from "./utils/path-utils.js";

export {
	detectLineEnding,
	normalizeToLF,
	restoreLineEndings,
	normalizeForFuzzyMatch,
	fuzzyFindText,
	stripBom,
	generateDiffString,
	type FuzzyMatchResult,
} from "./utils/edit-diff.js";
