/**
 * Daytona operations adapter — routes all tool I/O through Daytona SDK.
 * The agent doesn't know it's running remotely.
 */

import type { DaytonaWorkspace } from "@assembly-lime/shared";
import type { OperationsBundle } from "@assembly-lime/pi-coding-agent-tools";

export function createDaytonaOps(workspace: DaytonaWorkspace): OperationsBundle {
	const sandbox = workspace.sandbox;
	const repoDir = workspace.repoDir;

	/** Resolve relative path to absolute within Daytona sandbox repo dir */
	function toSandboxPath(relativePath: string): string {
		if (relativePath.startsWith("/")) return relativePath;
		return `${repoDir}/${relativePath}`;
	}

	const bashOps = {
		exec: async (
			command: string,
			cwd: string,
			options: {
				onData: (data: Buffer) => void;
				signal?: AbortSignal;
				timeout?: number;
			},
		): Promise<{ exitCode: number | null }> => {
			// Daytona executeCommand is synchronous (waits for completion)
			// We pass timeout if provided
			const timeoutSec = options.timeout ?? undefined;
			const result = await sandbox.process.executeCommand(
				command,
				cwd || repoDir,
				undefined,
				timeoutSec,
			);

			// Send output to onData callback (single chunk)
			if (result.result) {
				options.onData(Buffer.from(result.result, "utf-8"));
			}

			return { exitCode: result.exitCode };
		},
	};

	const readOps = {
		readFile: async (absolutePath: string): Promise<Buffer> => {
			const content = await sandbox.fs.downloadFile(absolutePath);
			return Buffer.from(content);
		},
		access: async (absolutePath: string): Promise<void> => {
			try {
				await sandbox.fs.downloadFile(absolutePath);
			} catch {
				throw new Error(`File not accessible: ${absolutePath}`);
			}
		},
	};

	const writeOps = {
		writeFile: async (absolutePath: string, content: string): Promise<void> => {
			await workspace.writeFile(
				absolutePath.startsWith(repoDir + "/")
					? absolutePath.slice(repoDir.length + 1)
					: absolutePath,
				content,
			);
		},
		mkdir: async (dir: string): Promise<void> => {
			await sandbox.process.executeCommand(`mkdir -p '${dir}'`);
		},
	};

	const editOps = {
		readFile: readOps.readFile,
		writeFile: async (absolutePath: string, content: string): Promise<void> => {
			await sandbox.fs.uploadFile(Buffer.from(content, "utf-8"), absolutePath);
		},
		access: readOps.access,
	};

	const grepOps = {
		exec: async (command: string, cwd: string): Promise<{ stdout: string; exitCode: number }> => {
			const result = await sandbox.process.executeCommand(command, cwd || repoDir);
			return { stdout: result.result, exitCode: result.exitCode };
		},
		readFile: async (absolutePath: string): Promise<string> => {
			const buf = await sandbox.fs.downloadFile(absolutePath);
			return Buffer.from(buf).toString("utf-8");
		},
	};

	const findOps = {
		exec: async (command: string, cwd: string): Promise<{ stdout: string; exitCode: number }> => {
			const result = await sandbox.process.executeCommand(command, cwd || repoDir);
			return { stdout: result.result, exitCode: result.exitCode };
		},
	};

	const lsOps = {
		exists: async (absolutePath: string): Promise<boolean> => {
			try {
				const result = await sandbox.process.executeCommand(`test -e '${absolutePath}' && echo yes || echo no`);
				return result.result.trim() === "yes";
			} catch {
				return false;
			}
		},
		stat: async (absolutePath: string) => {
			const result = await sandbox.process.executeCommand(`test -d '${absolutePath}' && echo dir || echo file`);
			const isDir = result.result.trim() === "dir";
			return { isDirectory: () => isDir };
		},
		readdir: async (absolutePath: string): Promise<string[]> => {
			const result = await sandbox.process.executeCommand(`ls -1A '${absolutePath}'`);
			if (result.exitCode !== 0) {
				throw new Error(`Cannot read directory: ${absolutePath}`);
			}
			return result.result
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
		},
	};

	return {
		bash: bashOps,
		read: readOps,
		write: writeOps,
		edit: editOps,
		grep: grepOps,
		find: findOps,
		ls: lsOps,
	};
}
