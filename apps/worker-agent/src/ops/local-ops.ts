/**
 * Local operations adapter — thin wrappers around node:fs and Bun.spawn.
 * Used for dev mode without Daytona.
 */

import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { OperationsBundle } from "@assembly-lime/pi-coding-agent-tools";

export function createLocalOps(defaultCwd: string): OperationsBundle {
	const bashOps = {
		exec: (
			command: string,
			cwd: string,
			options: {
				onData: (data: Buffer) => void;
				signal?: AbortSignal;
				timeout?: number;
			},
		): Promise<{ exitCode: number | null }> => {
			return new Promise((resolve, reject) => {
				const child = Bun.spawn(["bash", "-c", command], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
				});

				let timedOut = false;
				let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

				if (options.timeout !== undefined && options.timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						child.kill();
					}, options.timeout * 1000);
				}

				const onAbort = () => child.kill();
				if (options.signal) {
					if (options.signal.aborted) {
						child.kill();
					} else {
						options.signal.addEventListener("abort", onAbort, { once: true });
					}
				}

				// Stream stdout and stderr
				const streamReader = async (stream: ReadableStream<Uint8Array> | null) => {
					if (!stream) return;
					const reader = stream.getReader();
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							options.onData(Buffer.from(value));
						}
					} catch {
						// Stream closed
					}
				};

				Promise.all([
					streamReader(child.stdout as ReadableStream<Uint8Array>),
					streamReader(child.stderr as ReadableStream<Uint8Array>),
					child.exited,
				]).then(([, , exitCode]) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (options.signal) options.signal.removeEventListener("abort", onAbort);

					if (options.signal?.aborted) {
						reject(new Error("aborted"));
						return;
					}
					if (timedOut) {
						reject(new Error(`timeout:${options.timeout}`));
						return;
					}
					resolve({ exitCode });
				}).catch((err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (options.signal) options.signal.removeEventListener("abort", onAbort);
					reject(err);
				});
			});
		},
	};

	const readOps = {
		readFile: (absolutePath: string) => readFile(absolutePath),
		access: (absolutePath: string) => access(absolutePath, constants.R_OK),
	};

	const writeOps = {
		writeFile: (absolutePath: string, content: string) => writeFile(absolutePath, content, "utf-8"),
		mkdir: (dir: string) => mkdir(dir, { recursive: true }).then(() => {}),
	};

	const editOps = {
		readFile: (absolutePath: string) => readFile(absolutePath),
		writeFile: (absolutePath: string, content: string) => writeFile(absolutePath, content, "utf-8"),
		access: (absolutePath: string) => access(absolutePath, constants.R_OK | constants.W_OK),
	};

	const grepOps = {
		exec: async (command: string, cwd: string): Promise<{ stdout: string; exitCode: number }> => {
			const child = Bun.spawn(["bash", "-c", command], {
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			const stdout = await new Response(child.stdout).text();
			const exitCode = await child.exited;
			return { stdout, exitCode };
		},
		readFile: async (absolutePath: string): Promise<string> => {
			const buf = await readFile(absolutePath);
			return buf.toString("utf-8");
		},
	};

	const findOps = {
		exec: async (command: string, cwd: string): Promise<{ stdout: string; exitCode: number }> => {
			const child = Bun.spawn(["bash", "-c", command], {
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			const stdout = await new Response(child.stdout).text();
			const exitCode = await child.exited;
			return { stdout, exitCode };
		},
	};

	const lsOps = {
		exists: async (absolutePath: string): Promise<boolean> => {
			try {
				await access(absolutePath);
				return true;
			} catch {
				return false;
			}
		},
		stat: async (absolutePath: string) => {
			const s = await stat(absolutePath);
			return { isDirectory: () => s.isDirectory() };
		},
		readdir: (absolutePath: string) => readdir(absolutePath),
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
