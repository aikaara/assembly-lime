import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  tenants,
  users,
  roles,
  userRoles,
  projects,
  boards,
  connectors,
  repositories,
} from "@assembly-lime/shared/db/schema";
import type { GitHubUser } from "../lib/github-oauth";
import { encryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "auth-service" });

const DEFAULT_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "code_review", label: "Code Review" },
  { key: "qa", label: "QA" },
  { key: "done", label: "Done" },
];

const SEED_ROLES = ["admin", "pm", "dev", "qa"];

export async function findOrCreateUserFromGitHub(
  db: Db,
  ghUser: GitHubUser,
  accessToken: string,
): Promise<{ userId: number; tenantId: number }> {
  // 1. Lookup by githubUserId
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.githubUserId, ghUser.id),
  });

  if (existing) {
    log.info({ userId: existing.id, githubLogin: ghUser.login }, "existing user found, updating profile");
    await db
      .update(users)
      .set({
        name: ghUser.name ?? existing.name,
        avatarUrl: ghUser.avatar_url,
        githubLogin: ghUser.login,
      })
      .where(eq(users.id, existing.id));

    // Ensure connector exists, then sync repos in the background
    try {
      const connectorId = await ensureConnector(db, existing.tenantId, accessToken);
      syncReposFromGitHub(db, existing.tenantId, connectorId, accessToken).catch((err) =>
        log.error({ err, tenantId: existing.tenantId }, "background repo sync failed")
      );
    } catch (err) {
      log.error({ err, tenantId: existing.tenantId }, "failed to create/update connector on login");
    }

    return { userId: existing.id, tenantId: existing.tenantId };
  }

  // 2. Create tenant
  log.info({ githubLogin: ghUser.login }, "creating new tenant and user for first-time login");
  const [tenant] = await db
    .insert(tenants)
    .values({ name: ghUser.login, slug: ghUser.login.toLowerCase() })
    .returning();

  const tenantId = tenant!.id;

  // 3. Create user
  const [user] = await db
    .insert(users)
    .values({
      tenantId,
      email: ghUser.email,
      name: ghUser.name ?? ghUser.login,
      avatarUrl: ghUser.avatar_url,
      githubLogin: ghUser.login,
      githubUserId: ghUser.id,
    })
    .returning();

  const userId = user!.id;
  log.info({ userId, tenantId, githubLogin: ghUser.login }, "created tenant and user");

  // 4. Seed roles + assign admin
  const insertedRoles = await db
    .insert(roles)
    .values(SEED_ROLES.map((name) => ({ tenantId, name, permissionsJson: {} })))
    .returning();

  const adminRole = insertedRoles.find((r) => r.name === "admin");
  if (adminRole) {
    await db
      .insert(userRoles)
      .values({ tenantId, userId, roleId: adminRole.id });
  }

  // 5. Create default project + board
  const [project] = await db
    .insert(projects)
    .values({ tenantId, name: "My Project", key: "PROJ" })
    .returning();

  await db.insert(boards).values({
    tenantId,
    projectId: project!.id,
    name: "Main Board",
    columnsJson: DEFAULT_COLUMNS,
  });

  // Ensure connector exists, then sync repos in the background
  try {
    const connectorId = await ensureConnector(db, tenantId, accessToken);
    syncReposFromGitHub(db, tenantId, connectorId, accessToken).catch((err) =>
      log.error({ err, tenantId }, "background repo sync failed")
    );
  } catch (err) {
    log.error({ err, tenantId }, "failed to create connector on first login");
  }

  return { userId, tenantId };
}

// ── Connector + repo sync on login ──────────────────────────────────

const GITHUB_API = "https://api.github.com";

/**
 * Create or update the GitHub connector for this tenant.
 * This MUST be awaited during login so the connector always exists.
 */
async function ensureConnector(
  db: Db,
  tenantId: number,
  accessToken: string,
): Promise<number> {
  const existing = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, 1)))
    .limit(1);

  const accessTokenEnc = encryptToken(accessToken);

  if (existing.length > 0) {
    const connectorId = existing[0]!.id;
    await db
      .update(connectors)
      .set({ accessTokenEnc })
      .where(eq(connectors.id, connectorId));
    log.info({ connectorId, tenantId }, "updated existing connector token");
    return connectorId;
  }

  const [row] = await db
    .insert(connectors)
    .values({
      tenantId,
      provider: 1, // github
      externalOrg: null, // personal repos via /user/repos
      authType: 1, // oauth
      accessTokenEnc,
      scopesJson: ["repo", "read:user"],
      status: 1,
    })
    .returning();

  const connectorId = row!.id;
  log.info({ connectorId, tenantId }, "auto-created connector from OAuth");
  return connectorId;
}

/** Extract the "next" page URL from a GitHub Link header. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

/**
 * Fetch repos from GitHub (all pages) and import them. Safe to run as fire-and-forget.
 */
async function syncReposFromGitHub(
  db: Db,
  tenantId: number,
  connectorId: number,
  accessToken: string,
) {
  const ghRepos: Array<{
    id: number;
    name: string;
    full_name: string;
    clone_url: string;
    default_branch: string;
    owner: { login: string };
  }> = [];

  let url: string | null = `${GITHUB_API}/user/repos?per_page=100&sort=updated`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      log.warn({ status: res.status, tenantId, url }, "failed to fetch repos from GitHub");
      break;
    }

    const page = (await res.json()) as typeof ghRepos;
    ghRepos.push(...page);
    url = parseNextLink(res.headers.get("link"));
  }

  let imported = 0;
  for (const r of ghRepos) {
    const [row] = await db
      .insert(repositories)
      .values({
        tenantId,
        connectorId,
        provider: 1,
        externalRepoId: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        defaultBranch: r.default_branch,
      })
      .onConflictDoNothing()
      .returning();
    if (row) imported++;
  }

  log.info({ tenantId, connectorId, total: ghRepos.length, imported }, "auto-synced repos from GitHub");
}

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    githubLogin: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  roles: string[];
  projects: Array<{ id: string; name: string; key: string }>;
};

export async function getCurrentUser(
  db: Db,
  userId: number,
  tenantId: number,
): Promise<MeResponse | null> {
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  if (!user) return null;

  const tenant = await db.query.tenants.findFirst({
    where: (t, { eq }) => eq(t.id, tenantId),
  });
  if (!tenant) return null;

  const userRoleRows = await db.query.userRoles.findMany({
    where: (ur, { eq }) => eq(ur.userId, userId),
  });

  const roleIds = userRoleRows.map((ur) => ur.roleId);
  let roleNames: string[] = [];
  if (roleIds.length > 0) {
    const allRoles = await db.query.roles.findMany({
      where: (r, { eq: eqOp }) => eqOp(r.tenantId, tenantId),
    });
    roleNames = allRoles
      .filter((r) => roleIds.includes(r.id))
      .map((r) => r.name);
  }

  const projectList = await db.query.projects.findMany({
    where: (p, { eq }) => eq(p.tenantId, tenantId),
  });

  return {
    user: {
      id: String(user.id),
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      githubLogin: user.githubLogin ?? null,
    },
    tenant: {
      id: String(tenant.id),
      name: tenant.name,
      slug: tenant.slug,
    },
    roles: roleNames,
    projects: projectList.map((p) => ({
      id: String(p.id),
      name: p.name,
      key: p.key,
    })),
  };
}
