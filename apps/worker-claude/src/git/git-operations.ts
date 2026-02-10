import { logger } from "../lib/logger";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";

export type FileChange = {
  path: string;
  content: string | null; // null = delete
  action: "create" | "modify" | "delete";
};

export type CommitResult = {
  commitSha: string;
  diffStats: string;
};

async function execGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.error({ args, cwd, exitCode, stderr: stderr.slice(0, 500) }, "git command failed");
  }

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function getCurrentBranch(workDir: string): Promise<string> {
  const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], workDir);
  return stdout;
}

export function applyFileChanges(workDir: string, changes: FileChange[]): void {
  for (const change of changes) {
    const fullPath = join(workDir, change.path);

    if (change.action === "delete") {
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        logger.info({ path: change.path }, "file deleted");
      }
      continue;
    }

    // create or modify
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, change.content ?? "", "utf-8");
    logger.info({ path: change.path, action: change.action }, "file written");
  }
}

export async function stageAll(workDir: string): Promise<void> {
  await execGit(["add", "-A"], workDir);
}

export async function commit(workDir: string, message: string): Promise<string> {
  const { stdout, exitCode } = await execGit(["commit", "-m", message], workDir);
  if (exitCode !== 0) {
    throw new Error(`git commit failed: ${stdout}`);
  }
  const { stdout: sha } = await execGit(["rev-parse", "HEAD"], workDir);
  return sha;
}

export async function push(workDir: string, branch: string): Promise<void> {
  const { exitCode, stderr } = await execGit(["push", "origin", branch], workDir);
  if (exitCode !== 0) {
    throw new Error(`git push failed: ${stderr}`);
  }
}

export async function commitAndPush(
  workDir: string,
  branch: string,
  message: string
): Promise<CommitResult> {
  await stageAll(workDir);

  // Check if there are staged changes
  const { stdout: status } = await execGit(["status", "--porcelain"], workDir);
  if (!status) {
    throw new Error("No changes to commit");
  }

  const commitSha = await commit(workDir, message);
  await push(workDir, branch);

  const diffStats = await getDiffStats(workDir, `${branch}~1`);

  return { commitSha, diffStats };
}

export async function getDiffUnified(workDir: string, base: string): Promise<string> {
  const { stdout } = await execGit(["diff", base, "HEAD"], workDir);
  return stdout;
}

export async function getDiffStats(workDir: string, base: string): Promise<string> {
  const { stdout } = await execGit(["diff", "--stat", base, "HEAD"], workDir);
  return stdout;
}
