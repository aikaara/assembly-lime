/**
 * All *Operations interfaces for pluggable tool backends.
 * Implement these to route tool I/O through Daytona, SSH, local FS, etc.
 */

import type { TruncationResult } from "./utils/truncate.js";

// ── Bash ──────────────────────────────────────────────────────────────

export interface BashOperations {
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

// ── Read ──────────────────────────────────────────────────────────────

export interface ReadOperations {
	readFile: (absolutePath: string) => Promise<Buffer>;
	access: (absolutePath: string) => Promise<void>;
}

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

// ── Write ─────────────────────────────────────────────────────────────

export interface WriteOperations {
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	mkdir: (dir: string) => Promise<void>;
}

// ── Edit ──────────────────────────────────────────────────────────────

export interface EditOperations {
	readFile: (absolutePath: string) => Promise<Buffer>;
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	access: (absolutePath: string) => Promise<void>;
}

export interface EditToolDetails {
	diff: string;
	firstChangedLine?: number;
}

// ── Grep ──────────────────────────────────────────────────────────────

export interface GrepOperations {
	/** Execute a command (rg/grep) and return stdout + exit code */
	exec: (command: string, cwd: string) => Promise<{ stdout: string; exitCode: number }>;
	/** Read file contents for context lines */
	readFile: (absolutePath: string) => Promise<string> | string;
}

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

// ── Find ──────────────────────────────────────────────────────────────

export interface FindOperations {
	/** Execute a command (fd/find) and return stdout + exit code */
	exec: (command: string, cwd: string) => Promise<{ stdout: string; exitCode: number }>;
}

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

// ── Ls ────────────────────────────────────────────────────────────────

export interface LsOperations {
	exists: (absolutePath: string) => Promise<boolean> | boolean;
	stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };
	readdir: (absolutePath: string) => Promise<string[]> | string[];
}

export interface LsToolDetails {
	truncation?: TruncationResult;
	entryLimitReached?: number;
}

// ── Bundle ────────────────────────────────────────────────────────────

/** All operations needed to create a full tool set */
export interface OperationsBundle {
	bash: BashOperations;
	read: ReadOperations;
	write: WriteOperations;
	edit: EditOperations;
	grep: GrepOperations;
	find: FindOperations;
	ls: LsOperations;
}
