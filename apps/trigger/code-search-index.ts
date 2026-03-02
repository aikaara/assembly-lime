import { task, logger } from "@trigger.dev/sdk/v3";
import { generateInstallationToken, isGitHubAppConfigured, DaytonaWorkspace } from "@assembly-lime/shared";
import { createEmbeddingProvider } from "@assembly-lime/shared";
import { chunkFile, shouldSkipFile } from "@assembly-lime/shared/code-chunker";

export interface CodeSearchIndexPayload {
  tenantId: number;
  repositoryId: number;
  repoFullName: string;
  cloneUrl: string;
  defaultBranch: string;
  connectorId: number;
  lastIndexedSha?: string;
  authToken?: string;
}

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

async function postInternal(path: string, data: unknown): Promise<Response> {
  return fetch(`${API_BASE_URL}/internal/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": INTERNAL_KEY,
    },
    body: JSON.stringify(data),
  });
}

export const codeSearchIndexTask = task({
  id: "code-search-index",
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async (payload: CodeSearchIndexPayload) => {
    logger.info("code search indexing started", {
      tenantId: payload.tenantId,
      repositoryId: payload.repositoryId,
      repoFullName: payload.repoFullName,
      lastIndexedSha: payload.lastIndexedSha,
    });

    // Update status to indexing
    await postInternal(`repo-index-status/${payload.repositoryId}`, {
      tenantId: payload.tenantId,
      status: "indexing",
    });

    let workspace: DaytonaWorkspace | undefined;

    try {
      // 1. Resolve auth token
      let authToken = payload.authToken;
      if (!authToken && isGitHubAppConfigured()) {
        const owner = payload.repoFullName.split("/")[0]!;
        const token = await generateInstallationToken(owner);
        authToken = token.token;
      }

      // 2. Create sandbox and clone repo
      workspace = await DaytonaWorkspace.createSandbox({
        runId: 0,
        provider: "claude",
        mode: "plan",
        repoName: payload.repoFullName.split("/")[1] ?? "repo",
      });

      await workspace.cloneRepo({
        cloneUrl: payload.cloneUrl,
        defaultBranch: payload.defaultBranch,
        authToken,
      });

      const repoDir = workspace.repoDir;

      // 3. Determine files to index (incremental or full)
      let filesToIndex: string[];
      let deletedFiles: string[] = [];

      if (payload.lastIndexedSha) {
        // Incremental: get changed files since last index
        const { stdout: diffOutput } = await workspace.exec(
          `cd ${repoDir} && git diff --name-only --diff-filter=ACMR ${payload.lastIndexedSha}..HEAD 2>/dev/null || echo ""`
        );
        const { stdout: deletedOutput } = await workspace.exec(
          `cd ${repoDir} && git diff --name-only --diff-filter=D ${payload.lastIndexedSha}..HEAD 2>/dev/null || echo ""`
        );

        filesToIndex = diffOutput.trim().split("\n").filter(Boolean);
        deletedFiles = deletedOutput.trim().split("\n").filter(Boolean);

        logger.info(`incremental index: ${filesToIndex.length} changed, ${deletedFiles.length} deleted`);
      } else {
        // Full index: list all files
        const { stdout: filesOutput } = await workspace.exec(
          `cd ${repoDir} && git ls-files`
        );
        filesToIndex = filesOutput.trim().split("\n").filter(Boolean);
        logger.info(`full index: ${filesToIndex.length} files`);
      }

      // 4. Filter and read files, chunk them
      const allChunks: Array<ReturnType<typeof chunkFile>[number] & { commitSha: string }> = [];
      let fileCount = 0;

      // Get current HEAD sha
      const { stdout: headSha } = await workspace.exec(
        `cd ${repoDir} && git rev-parse HEAD`
      );
      const commitSha = headSha.trim();

      for (const file of filesToIndex) {
        if (shouldSkipFile(file)) continue;

        try {
          const { stdout: content } = await workspace.exec(
            `cd ${repoDir} && cat "${file}" 2>/dev/null || echo ""`
          );
          if (!content.trim()) continue;

          const chunks = chunkFile(file, content);
          if (chunks.length > 0) {
            fileCount++;
            for (const chunk of chunks) {
              allChunks.push({ ...chunk, commitSha });
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      logger.info(`chunked ${fileCount} files into ${allChunks.length} chunks`);

      // 5. Batch embed
      const embeddingProvider = createEmbeddingProvider();
      const batchSize = 128;
      const embeddings: number[][] = [];

      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);
        const texts = batch.map((c) => {
          const header = c.contextHeader ? `${c.contextHeader}\n` : "";
          const symbol = c.symbolName ? `${c.chunkType} ${c.symbolName}: ` : "";
          return `${header}${symbol}${c.content}`.slice(0, 8000);
        });

        const batchEmbeddings = await embeddingProvider.generateEmbeddings(texts, "document");
        embeddings.push(...batchEmbeddings);

        logger.info(`embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`);
      }

      // 6. Batch upsert via internal API
      const chunkBatchSize = 50;
      for (let i = 0; i < allChunks.length; i += chunkBatchSize) {
        const batchChunks = allChunks.slice(i, i + chunkBatchSize).map((chunk, idx) => ({
          filePath: chunk.filePath,
          chunkType: chunk.chunkType,
          symbolName: chunk.symbolName,
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contextHeader: chunk.contextHeader,
          embedding: embeddings[i + idx]!,
        }));

        await postInternal(`code-chunks/${payload.repositoryId}`, {
          tenantId: payload.tenantId,
          commitSha,
          deleteFilePaths: i === 0 ? deletedFiles : undefined,
          chunks: batchChunks,
        });
      }

      // 7. Finalize: update status to ready
      await postInternal(`repo-index-status/${payload.repositoryId}`, {
        tenantId: payload.tenantId,
        status: "ready",
        lastIndexedSha: commitSha,
        fileCount,
        chunkCount: allChunks.length,
      });

      logger.info("code search indexing completed", {
        repositoryId: payload.repositoryId,
        fileCount,
        chunkCount: allChunks.length,
        commitSha,
      });

      // 8. Cleanup sandbox
      if (workspace) {
        try {
          await workspace.stop();
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("code search indexing failed", { error: message });

      await postInternal(`repo-index-status/${payload.repositoryId}`, {
        tenantId: payload.tenantId,
        status: "failed",
        error: message,
      });

      if (workspace) {
        try {
          await workspace.stop();
        } catch {
          // non-fatal
        }
      }

      throw err;
    }
  },
});
