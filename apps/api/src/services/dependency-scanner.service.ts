import { eq, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@assembly-lime/shared/db";
import {
  repositories,
  connectors,
  dependencyScans,
} from "@assembly-lime/shared/db/schema";
import { getConnectorToken } from "./connector.service";
import { storeDependencies, clearDependencies } from "./repo-dependency.service";
import type { DependencyEdge } from "./repo-dependency.service";
import type { JobLogger } from "../lib/queue";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "dependency-scanner" });

const GITHUB_API = "https://api.github.com";

const DEPENDENCY_FILES = [
  "package.json",
  "Gemfile",
  "requirements.txt",
  "setup.py",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Podfile",
  "pubspec.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  ".gitmodules",
];

type RepoManifest = {
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  files: { path: string; content: string }[];
};

/** Noop logger for non-queue callers */
const noopLog: JobLogger = async () => {};
const noopProgress = async (_: number) => {};

async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function gatherRepoManifests(
  db: Db,
  tenantId: number,
  jobLog: JobLogger,
  updateProgress: (pct: number) => Promise<void>
): Promise<RepoManifest[]> {
  const repos = await db
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.tenantId, tenantId), eq(repositories.isEnabled, true))
    );

  if (repos.length === 0) return [];

  await jobLog(`Found ${repos.length} enabled repositories`);

  // Get first active connector for token
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, 1)))
    .limit(1);

  if (!connector) {
    await jobLog("No active GitHub connector found — aborting scan");
    return [];
  }

  const token = getConnectorToken(connector);
  const manifests: RepoManifest[] = [];

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    const files: { path: string; content: string }[] = [];

    await jobLog(`[${i + 1}/${repos.length}] Fetching manifests for ${repo.fullName}`);

    for (const filePath of DEPENDENCY_FILES) {
      const content = await fetchFileContent(token, repo.owner, repo.name, filePath);
      if (content) {
        files.push({ path: filePath, content: content.slice(0, 8192) });
      }
    }

    await jobLog(`  → ${repo.fullName}: found ${files.length} manifest file(s)${files.length > 0 ? ` (${files.map(f => f.path).join(", ")})` : ""}`);

    manifests.push({
      repoId: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      files,
    });

    // Progress: 5% – 60% for fetching manifests
    const fetchProgress = 5 + Math.round(((i + 1) / repos.length) * 55);
    await updateProgress(fetchProgress);
  }

  const totalFiles = manifests.reduce((sum, m) => sum + m.files.length, 0);
  await jobLog(`Manifest collection complete: ${manifests.length} repos, ${totalFiles} files total`);

  return manifests;
}

const SCAN_SYSTEM_PROMPT = `You are a dependency analysis agent. You are given a list of repositories belonging to the same organization, along with their dependency manifests (package.json, Gemfile, Dockerfile, etc).

Your task: identify cross-repository dependencies where one repo depends on or references another repo in the list.

Dependency types:
- "package": Repo A lists Repo B (or its published package) as a dependency
- "api_consumer": Repo A consumes an API that Repo B provides (e.g. shared API URLs, client SDK usage)
- "sdk_usage": Repo A uses an SDK published by Repo B
- "docker_ref": Repo A references Repo B in Docker configs (e.g. docker-compose service names, Dockerfile base images)
- "submodule": Repo A includes Repo B as a git submodule
- "shared_config": Repos share configuration files or reference common config patterns

Return ONLY a JSON array. Each element:
{
  "source": "owner/repo-name",
  "target": "owner/repo-name",
  "type": "package|api_consumer|sdk_usage|docker_ref|submodule|shared_config",
  "confidence": 0-100,
  "detectedFrom": "path/to/file",
  "metadata": { "packageName": "...", "version": "...", "notes": "..." }
}

Rules:
- source depends on target (source → target means source uses/imports/references target)
- Only include dependencies between repos in the provided list
- Be precise with confidence: 90+ for exact package name matches, 60-89 for likely matches, below 60 for heuristic guesses
- If no cross-repo dependencies are found, return an empty array: []
- Return ONLY the JSON array, no markdown fencing, no explanation`;

async function analyzeDependenciesWithClaude(
  manifests: RepoManifest[],
  jobLog: JobLogger,
  updateProgress: (pct: number) => Promise<void>
): Promise<
  Array<{
    source: string;
    target: string;
    type: string;
    confidence: number;
    detectedFrom: string;
    metadata: Record<string, unknown>;
  }>
> {
  const anthropic = new Anthropic();

  const repoSummaries = manifests.map((m) => ({
    fullName: m.fullName,
    files: m.files.map((f) => ({
      path: f.path,
      content: f.content,
    })),
  }));

  const userMessage = `Here are the repositories and their dependency manifests:\n\n${JSON.stringify(repoSummaries, null, 2)}`;
  const inputChars = userMessage.length;

  await jobLog(`Calling Claude API to analyze dependencies (${Math.round(inputChars / 1024)}KB context)...`);
  await updateProgress(65);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SCAN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const usage = response.usage;
  await jobLog(`Claude API response received — input_tokens: ${usage.input_tokens}, output_tokens: ${usage.output_tokens}`);
  await updateProgress(80);

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      await jobLog(`Claude returned ${parsed.length} dependency edge(s)`);
      return parsed;
    }
    await jobLog("Claude returned non-array JSON, treating as empty");
    return [];
  } catch {
    // Try to extract JSON array from the response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        await jobLog(`Extracted ${parsed.length} dependency edge(s) from Claude response`);
        return parsed;
      } catch {
        await jobLog("Failed to parse extracted JSON from Claude response");
        return [];
      }
    }
    await jobLog("Claude response was not parseable JSON — no dependencies extracted");
    return [];
  }
}

export async function scanAllDependencies(
  db: Db,
  tenantId: number,
  jobLog: JobLogger = noopLog,
  updateProgress: (pct: number) => Promise<void> = noopProgress
) {
  // Create scan record
  const [scan] = await db
    .insert(dependencyScans)
    .values({ tenantId, status: "pending" })
    .returning();

  const scanId = scan!.id;
  await jobLog(`Created scan record #${scanId}`);

  try {
    // Update to running
    await db
      .update(dependencyScans)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(dependencyScans.id, scanId));

    await jobLog("Scan status → running");
    await updateProgress(5);

    // Gather manifests
    const manifests = await gatherRepoManifests(db, tenantId, jobLog, updateProgress);

    if (manifests.length === 0) {
      await jobLog("No enabled repos found — scan complete with 0 dependencies");
      await db
        .update(dependencyScans)
        .set({
          status: "completed",
          reposScanned: 0,
          depsFound: 0,
          completedAt: new Date(),
        })
        .where(eq(dependencyScans.id, scanId));
      return { scanId, reposScanned: 0, depsFound: 0 };
    }

    // Check if any repo has manifest files (skip AI if none)
    const totalFiles = manifests.reduce((sum, m) => sum + m.files.length, 0);
    if (totalFiles === 0) {
      await jobLog("No dependency manifest files found in any repo — skipping AI analysis");
      await db
        .update(dependencyScans)
        .set({
          status: "completed",
          reposScanned: manifests.length,
          depsFound: 0,
          completedAt: new Date(),
        })
        .where(eq(dependencyScans.id, scanId));
      return { scanId, reposScanned: manifests.length, depsFound: 0 };
    }

    // Analyze with Claude
    const rawDeps = await analyzeDependenciesWithClaude(manifests, jobLog, updateProgress);

    // Map fullName → repoId for resolution
    const nameToId = new Map<string, number>();
    for (const m of manifests) {
      nameToId.set(m.fullName, m.repoId);
      nameToId.set(m.name, m.repoId);
    }

    // Convert raw deps to DB format
    const edges: DependencyEdge[] = [];
    let skipped = 0;
    for (const dep of rawDeps) {
      const sourceId = nameToId.get(dep.source);
      const targetId = nameToId.get(dep.target);
      if (!sourceId || !targetId) {
        skipped++;
        continue;
      }
      if (sourceId === targetId) {
        skipped++;
        continue;
      }

      edges.push({
        sourceRepositoryId: sourceId,
        targetRepositoryId: targetId,
        dependencyType: dep.type,
        confidence: Math.max(0, Math.min(100, dep.confidence)),
        detectedFrom: dep.detectedFrom ?? null,
        metadata: dep.metadata ?? {},
      });
    }

    if (skipped > 0) {
      await jobLog(`Skipped ${skipped} unresolvable/self-referencing edge(s)`);
    }

    await jobLog(`Resolved ${edges.length} valid dependency edge(s)`);
    await updateProgress(85);

    // Log each edge
    for (const edge of edges) {
      const srcName = manifests.find(m => m.repoId === edge.sourceRepositoryId)?.fullName ?? "?";
      const tgtName = manifests.find(m => m.repoId === edge.targetRepositoryId)?.fullName ?? "?";
      await jobLog(`  ${srcName} → ${tgtName} [${edge.dependencyType}] (confidence: ${edge.confidence}%)`);
    }

    // Clear old dependencies and store new ones
    await jobLog("Clearing old dependencies and storing new edges...");
    await clearDependencies(db, tenantId);
    const depsStored = await storeDependencies(db, tenantId, edges);
    await updateProgress(95);

    // Update scan to completed
    await db
      .update(dependencyScans)
      .set({
        status: "completed",
        reposScanned: manifests.length,
        depsFound: depsStored,
        completedAt: new Date(),
      })
      .where(eq(dependencyScans.id, scanId));

    await jobLog(`Scan complete — ${manifests.length} repos scanned, ${depsStored} dependencies stored`);

    log.info(
      { tenantId, scanId, reposScanned: manifests.length, depsFound: depsStored },
      "dependency scan completed"
    );

    return { scanId, reposScanned: manifests.length, depsFound: depsStored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(dependencyScans)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(dependencyScans.id, scanId));

    await jobLog(`SCAN FAILED: ${message}`);
    log.error({ tenantId, scanId, err: message }, "dependency scan failed");
    throw err;
  }
}
