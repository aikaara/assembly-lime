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
  tenantId: number
): Promise<RepoManifest[]> {
  const repos = await db
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.tenantId, tenantId), eq(repositories.isEnabled, true))
    );

  if (repos.length === 0) return [];

  // Get first active connector for token
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, 1)))
    .limit(1);

  if (!connector) {
    log.warn({ tenantId }, "no active connector found for dependency scan");
    return [];
  }

  const token = getConnectorToken(connector);
  const manifests: RepoManifest[] = [];

  for (const repo of repos) {
    const files: { path: string; content: string }[] = [];

    for (const filePath of DEPENDENCY_FILES) {
      const content = await fetchFileContent(token, repo.owner, repo.name, filePath);
      if (content) {
        // Limit file content to 8KB to avoid overloading the prompt
        files.push({ path: filePath, content: content.slice(0, 8192) });
      }
    }

    manifests.push({
      repoId: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      files,
    });
  }

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
  manifests: RepoManifest[]
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

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: SCAN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    // Try to parse the raw text as JSON
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Try to extract JSON array from the response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        log.warn("failed to parse Claude dependency analysis response");
        return [];
      }
    }
    return [];
  }
}

export async function scanAllDependencies(db: Db, tenantId: number) {
  // Create scan record
  const [scan] = await db
    .insert(dependencyScans)
    .values({ tenantId, status: "pending" })
    .returning();

  const scanId = scan!.id;

  try {
    // Update to running
    await db
      .update(dependencyScans)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(dependencyScans.id, scanId));

    // Gather manifests
    const manifests = await gatherRepoManifests(db, tenantId);

    if (manifests.length === 0) {
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

    // Analyze with Claude
    const rawDeps = await analyzeDependenciesWithClaude(manifests);

    // Map fullName → repoId for resolution
    const nameToId = new Map<string, number>();
    for (const m of manifests) {
      nameToId.set(m.fullName, m.repoId);
      // Also map by just repo name for partial matches
      nameToId.set(m.name, m.repoId);
    }

    // Convert raw deps to DB format
    const edges: DependencyEdge[] = [];
    for (const dep of rawDeps) {
      const sourceId = nameToId.get(dep.source);
      const targetId = nameToId.get(dep.target);
      if (!sourceId || !targetId) {
        log.debug(
          { source: dep.source, target: dep.target },
          "skipping dependency: repo not found"
        );
        continue;
      }
      if (sourceId === targetId) continue; // skip self-references

      edges.push({
        sourceRepositoryId: sourceId,
        targetRepositoryId: targetId,
        dependencyType: dep.type,
        confidence: Math.max(0, Math.min(100, dep.confidence)),
        detectedFrom: dep.detectedFrom ?? null,
        metadata: dep.metadata ?? {},
      });
    }

    // Clear old dependencies and store new ones
    await clearDependencies(db, tenantId);
    const depsStored = await storeDependencies(db, tenantId, edges);

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

    log.error({ tenantId, scanId, err: message }, "dependency scan failed");
    throw err;
  }
}
