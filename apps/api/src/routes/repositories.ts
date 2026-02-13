import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { repositories, connectors, webhooks } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import { browseFileTree, getFileContent, listOrgRepos, importRepos } from "../services/github.service";
import { getConnectorToken } from "../services/connector.service";
import { scanRepoForConfigs, listRepoConfigs } from "../services/env-detection.service";
import { scanAllDependencies } from "../services/dependency-scanner.service";
import { ensureFork, getForkStatus } from "../services/fork.service";
import { encryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "repository-routes" });
const API_URL = process.env.API_URL ?? "http://localhost:3434";

export function repositoryRoutes(db: Db) {
  return new Elysia({ prefix: "/repositories" })
    .use(requireAuth)
    .get("/", async ({ auth }) => {
      const rows = await db
        .select()
        .from(repositories)
        .where(eq(repositories.tenantId, auth!.tenantId));
      return rows.map((r) => ({
        id: String(r.id),
        connectorId: String(r.connectorId),
        provider: r.provider,
        externalRepoId: r.externalRepoId ? String(r.externalRepoId) : null,
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        cloneUrl: r.cloneUrl,
        defaultBranch: r.defaultBranch,
        isEnabled: r.isEnabled,
        forkOwner: r.forkOwner,
        forkFullName: r.forkFullName,
        forkCloneUrl: r.forkCloneUrl,
        forkCreatedAt: r.forkCreatedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    })
    .get(
      "/:id",
      async ({ auth, params }) => {
        const [row] = await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          connectorId: String(row.connectorId),
          provider: row.provider,
          externalRepoId: row.externalRepoId ? String(row.externalRepoId) : null,
          owner: row.owner,
          name: row.name,
          fullName: row.fullName,
          cloneUrl: row.cloneUrl,
          defaultBranch: row.defaultBranch,
          isEnabled: row.isEnabled,
          forkOwner: row.forkOwner,
          forkFullName: row.forkFullName,
          forkCloneUrl: row.forkCloneUrl,
          forkCreatedAt: row.forkCreatedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/tree",
      async ({ auth, params, query }) => {
        const [repo] = await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)));
        if (!repo) return { error: "not found" };
        const tree = await browseFileTree(
          db,
          auth!.tenantId,
          repo.connectorId,
          repo.owner,
          repo.name,
          query.path,
          query.ref
        );
        return tree;
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          path: t.Optional(t.String()),
          ref: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/:id/file",
      async ({ auth, params, query }) => {
        const [repo] = await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)));
        if (!repo) return { error: "not found" };
        const file = await getFileContent(
          db,
          auth!.tenantId,
          repo.connectorId,
          repo.owner,
          repo.name,
          query.path,
          query.ref
        );
        return file;
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          path: t.String(),
          ref: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/:id/configs",
      async ({ auth, params }) => {
        const configs = await listRepoConfigs(db, auth!.tenantId, Number(params.id));
        return configs.map((c) => ({
          id: String(c.id),
          filePath: c.filePath,
          fileType: c.fileType,
          detectedKeys: c.detectedKeys,
          contentHash: c.contentHash,
          lastScannedAt: c.lastScannedAt.toISOString(),
        }));
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/:id/scan-configs",
      async ({ auth, params }) => {
        const [repo] = await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)));
        if (!repo) return { error: "not found" };
        log.info({ tenantId: auth!.tenantId, repositoryId: params.id }, "triggering config scan");
        const configs = await scanRepoForConfigs(db, auth!.tenantId, repo.connectorId, repo.id);
        return configs.map((c) => ({
          filePath: c.filePath,
          fileType: c.fileType,
          detectedKeys: c.detectedKeys,
        }));
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/sync",
      async ({ auth }) => {
        // Find the first active connector for this tenant
        const [connector] = await db
          .select()
          .from(connectors)
          .where(and(eq(connectors.tenantId, auth!.tenantId), eq(connectors.status, 1)))
          .limit(1);
        if (!connector) {
          return { error: "no_connector", message: "No GitHub connector found. Please connect GitHub first." };
        }
        log.info({ tenantId: auth!.tenantId, connectorId: connector.id }, "syncing repos from GitHub");
        const ghRepos = await listOrgRepos(db, auth!.tenantId, connector.id);
        const toImport = ghRepos.map((r) => ({
          externalRepoId: r.id,
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          cloneUrl: r.clone_url,
          defaultBranch: r.default_branch,
        }));
        const imported = await importRepos(db, auth!.tenantId, connector.id, toImport);
        log.info({ tenantId: auth!.tenantId, fetched: ghRepos.length, imported: imported.length }, "repo sync complete");

        // Fire-and-forget dependency scan after import
        scanAllDependencies(db, auth!.tenantId).catch((err) => {
          log.warn({ tenantId: auth!.tenantId, err }, "auto dependency scan after import failed");
        });

        return { fetched: ghRepos.length, imported: imported.length };
      }
    )
    .post(
      "/:id/webhook",
      async ({ auth, params }) => {
        // Get repo + connector
        const [repo] = await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)));
        if (!repo) return { error: "not found" };

        const [connector] = await db
          .select()
          .from(connectors)
          .where(and(eq(connectors.id, repo.connectorId), eq(connectors.tenantId, auth!.tenantId)));
        if (!connector) return { error: "connector not found" };
        const token = getConnectorToken(connector);

        // Generate webhook secret
        const secret = randomBytes(32).toString("hex");

        // Create webhook on GitHub
        const ghRes = await fetch(
          `https://api.github.com/repos/${repo.owner}/${repo.name}/hooks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              name: "web",
              active: true,
              events: ["push", "pull_request", "pull_request_review", "issues", "issue_comment", "workflow_run"],
              config: {
                url: `${API_URL}/github/webhook`,
                content_type: "json",
                secret,
              },
            }),
          }
        );

        if (!ghRes.ok) {
          const text = await ghRes.text();
          log.error({ status: ghRes.status, body: text, repoId: params.id }, "failed to create GitHub webhook");
          return { error: "github_api_error", message: `GitHub returned ${ghRes.status}` };
        }

        const ghWebhook = (await ghRes.json()) as { id: number };

        // Store webhook in DB
        const [row] = await db
          .insert(webhooks)
          .values({
            tenantId: auth!.tenantId,
            connectorId: repo.connectorId,
            provider: 1,
            externalWebhookId: ghWebhook.id,
            secretEnc: encryptToken(secret),
            eventsJson: ["push", "pull_request", "pull_request_review", "issues", "issue_comment", "workflow_run"],
            targetPath: `${repo.owner}/${repo.name}`,
            status: 1,
          })
          .returning();

        log.info({ tenantId: auth!.tenantId, repoId: params.id, webhookId: row!.id }, "webhook created");
        return {
          id: String(row!.id),
          externalWebhookId: String(ghWebhook.id),
          events: row!.eventsJson,
          status: row!.status,
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/webhook",
      async ({ auth, params }) => {
        const rows = await db
          .select()
          .from(webhooks)
          .where(
            and(
              eq(webhooks.tenantId, auth!.tenantId),
              eq(webhooks.targetPath,
                // Look up the repo to get owner/name
                await db
                  .select({ path: repositories.fullName })
                  .from(repositories)
                  .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)))
                  .then((r) => r[0]?.path ?? "")
              ),
              eq(webhooks.status, 1)
            )
          );
        return rows.map((w) => ({
          id: String(w.id),
          externalWebhookId: w.externalWebhookId ? String(w.externalWebhookId) : null,
          events: w.eventsJson,
          status: w.status,
          createdAt: w.createdAt.toISOString(),
        }));
      },
      { params: t.Object({ id: t.String() }) }
    )
    .patch(
      "/:id",
      async ({ auth, params, body }) => {
        const [row] = await db
          .update(repositories)
          .set({ isEnabled: body.isEnabled })
          .where(and(eq(repositories.id, Number(params.id)), eq(repositories.tenantId, auth!.tenantId)))
          .returning();
        if (!row) return { error: "not found" };
        return { id: String(row.id), isEnabled: row.isEnabled };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({ isEnabled: t.Boolean() }),
      }
    )
    .post(
      "/:id/fork",
      async ({ auth, params }) => {
        try {
          const fork = await ensureFork(db, auth!.tenantId, Number(params.id));
          return fork;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ repoId: params.id, err: msg }, "fork creation failed");
          return { error: msg };
        }
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/fork",
      async ({ auth, params }) => {
        const fork = await getForkStatus(db, auth!.tenantId, Number(params.id));
        return { fork };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
