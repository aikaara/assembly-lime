import { eq, and } from "drizzle-orm";
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

/** Noop logger for non-queue callers */
const noopLog: JobLogger = async () => {};
const noopProgress = async (_: number) => {};

type RepoManifest = {
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  packageJson: PackageJsonDeps | null;
  dockerRefs: string[];
  hasSubmodules: boolean;
};

type PackageJsonDeps = {
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
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
      },
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch only the files we actually need — package.json, Dockerfile, docker-compose.yml, .gitmodules.
 * All fetches within a repo run in parallel.
 */
async function gatherRepoManifests(
  db: Db,
  tenantId: number,
  jobLog: JobLogger,
  updateProgress: (pct: number) => Promise<void>,
): Promise<RepoManifest[]> {
  const repos = await db
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.tenantId, tenantId), eq(repositories.isEnabled, true)),
    );

  if (repos.length === 0) return [];

  await jobLog(`Found ${repos.length} enabled repositories`);

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

  // Fetch all repos in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (repo) => {
        // Fetch package.json, Dockerfile, docker-compose.yml, .gitmodules in parallel
        const [pkgRaw, dockerfile, compose, composeYml, gitmodules] = await Promise.all([
          fetchFileContent(token, repo.owner, repo.name, "package.json"),
          fetchFileContent(token, repo.owner, repo.name, "Dockerfile"),
          fetchFileContent(token, repo.owner, repo.name, "docker-compose.yml"),
          fetchFileContent(token, repo.owner, repo.name, "docker-compose.yaml"),
          fetchFileContent(token, repo.owner, repo.name, ".gitmodules"),
        ]);

        let packageJson: PackageJsonDeps | null = null;
        if (pkgRaw) {
          try {
            const parsed = JSON.parse(pkgRaw);
            packageJson = {
              name: parsed.name,
              dependencies: parsed.dependencies ?? {},
              devDependencies: parsed.devDependencies ?? {},
            };
          } catch {
            // malformed package.json
          }
        }

        // Extract image/service references from Docker files
        const dockerRefs: string[] = [];
        if (dockerfile) {
          const fromMatches = dockerfile.matchAll(/^FROM\s+([^\s]+)/gm);
          for (const m of fromMatches) dockerRefs.push(m[1]!);
        }
        const composeContent = compose || composeYml;
        if (composeContent) {
          const imageMatches = composeContent.matchAll(/image:\s*['"]?([^\s'"]+)/g);
          for (const m of imageMatches) dockerRefs.push(m[1]!);
        }

        return {
          repoId: repo.id,
          fullName: repo.fullName,
          owner: repo.owner,
          name: repo.name,
          packageJson,
          dockerRefs,
          hasSubmodules: !!gitmodules,
        } satisfies RepoManifest;
      }),
    );

    manifests.push(...results);

    const fetchProgress = 5 + Math.round(((i + batch.length) / repos.length) * 55);
    await updateProgress(fetchProgress);
    await jobLog(`Fetched manifests for ${Math.min(i + BATCH_SIZE, repos.length)}/${repos.length} repos`);
  }

  return manifests;
}

/**
 * Deterministic cross-repo dependency detection — no AI needed.
 *
 * Checks:
 * 1. package.json deps referencing another repo's package name or GitHub URL
 * 2. Docker image/FROM references matching repo names
 * 3. Git submodule presence (flagged but can't resolve targets without parsing .gitmodules content)
 */
function detectCrossRepoDeps(manifests: RepoManifest[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();

  // Build lookup: package name → repoId, repo name → repoId
  const packageNameToRepo = new Map<string, number>();
  const repoNameToRepo = new Map<string, number>();
  const repoFullNameToRepo = new Map<string, number>();

  for (const m of manifests) {
    if (m.packageJson?.name) {
      packageNameToRepo.set(m.packageJson.name, m.repoId);
    }
    repoNameToRepo.set(m.name.toLowerCase(), m.repoId);
    repoFullNameToRepo.set(m.fullName.toLowerCase(), m.repoId);
  }

  for (const source of manifests) {
    if (!source.packageJson) continue;

    const allDeps = {
      ...source.packageJson.dependencies,
      ...source.packageJson.devDependencies,
    };

    for (const [depName, depVersion] of Object.entries(allDeps)) {
      // 1. Direct package name match
      const targetByName = packageNameToRepo.get(depName);
      if (targetByName && targetByName !== source.repoId) {
        const key = `${source.repoId}-${targetByName}-package`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({
            sourceRepositoryId: source.repoId,
            targetRepositoryId: targetByName,
            dependencyType: "package",
            confidence: 95,
            detectedFrom: "package.json",
            metadata: { packageName: depName, version: depVersion },
          });
        }
        continue;
      }

      // 2. GitHub URL in version (github:org/repo, git+https://...)
      const githubMatch = depVersion.match(
        /(?:github:|git\+https?:\/\/github\.com\/)([^#@/]+\/[^#@]+)/,
      );
      if (githubMatch) {
        const refName = githubMatch[1]!.replace(/\.git$/, "").toLowerCase();
        const targetByUrl = repoFullNameToRepo.get(refName);
        if (targetByUrl && targetByUrl !== source.repoId) {
          const key = `${source.repoId}-${targetByUrl}-package`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({
              sourceRepositoryId: source.repoId,
              targetRepositoryId: targetByUrl,
              dependencyType: "package",
              confidence: 90,
              detectedFrom: "package.json",
              metadata: { packageName: depName, version: depVersion },
            });
          }
        }
      }
    }

    // 3. Docker references matching repo names
    for (const ref of source.dockerRefs) {
      const refLower = ref.toLowerCase();
      for (const m of manifests) {
        if (m.repoId === source.repoId) continue;
        if (
          refLower.includes(m.name.toLowerCase()) ||
          refLower.includes(m.fullName.toLowerCase())
        ) {
          const key = `${source.repoId}-${m.repoId}-docker_ref`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({
              sourceRepositoryId: source.repoId,
              targetRepositoryId: m.repoId,
              dependencyType: "docker_ref",
              confidence: 70,
              detectedFrom: "Dockerfile/docker-compose",
              metadata: { imageRef: ref },
            });
          }
        }
      }
    }
  }

  return edges;
}

export async function scanAllDependencies(
  db: Db,
  tenantId: number,
  jobLog: JobLogger = noopLog,
  updateProgress: (pct: number) => Promise<void> = noopProgress,
) {
  const [scan] = await db
    .insert(dependencyScans)
    .values({ tenantId, status: "pending" })
    .returning();

  const scanId = scan!.id;
  await jobLog(`Created scan record #${scanId}`);

  try {
    await db
      .update(dependencyScans)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(dependencyScans.id, scanId));

    await jobLog("Scan status → running");
    await updateProgress(5);

    // Gather manifests (parallel fetches)
    const manifests = await gatherRepoManifests(db, tenantId, jobLog, updateProgress);

    if (manifests.length === 0) {
      await jobLog("No enabled repos found — scan complete with 0 dependencies");
      await db
        .update(dependencyScans)
        .set({ status: "completed", reposScanned: 0, depsFound: 0, completedAt: new Date() })
        .where(eq(dependencyScans.id, scanId));
      return { scanId, reposScanned: 0, depsFound: 0 };
    }

    await updateProgress(65);

    // Deterministic cross-repo detection (no AI call)
    const edges = detectCrossRepoDeps(manifests);
    await jobLog(`Detected ${edges.length} cross-repo dependency edge(s)`);
    await updateProgress(80);

    for (const edge of edges) {
      const srcName = manifests.find((m) => m.repoId === edge.sourceRepositoryId)?.fullName ?? "?";
      const tgtName = manifests.find((m) => m.repoId === edge.targetRepositoryId)?.fullName ?? "?";
      await jobLog(`  ${srcName} → ${tgtName} [${edge.dependencyType}] (confidence: ${edge.confidence}%)`);
    }

    // Store results
    await jobLog("Clearing old dependencies and storing new edges...");
    await clearDependencies(db, tenantId);
    const depsStored = await storeDependencies(db, tenantId, edges);
    await updateProgress(95);

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
      "dependency scan completed",
    );

    return { scanId, reposScanned: manifests.length, depsFound: depsStored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(dependencyScans)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(dependencyScans.id, scanId));

    await jobLog(`SCAN FAILED: ${message}`);
    log.error({ tenantId, scanId, err: message }, "dependency scan failed");
    throw err;
  }
}
