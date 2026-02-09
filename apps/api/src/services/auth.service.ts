import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  tenants,
  users,
  roles,
  userRoles,
  projects,
  boards,
} from "@assembly-lime/shared/db/schema";
import type { GitHubUser } from "../lib/github-oauth";

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
): Promise<{ userId: number; tenantId: number }> {
  // 1. Lookup by githubUserId
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.githubUserId, ghUser.id),
  });

  if (existing) {
    // Update avatar/name
    await db
      .update(users)
      .set({
        name: ghUser.name ?? existing.name,
        avatarUrl: ghUser.avatar_url,
        githubLogin: ghUser.login,
      })
      .where(eq(users.id, existing.id));

    return { userId: existing.id, tenantId: existing.tenantId };
  }

  // 2. Create tenant
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

  return { userId, tenantId };
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
    with: { role: true } as never,
  });

  // Fallback: query roles directly if `with` didn't work
  const roleIds = userRoleRows.map((ur: any) => ur.roleId);
  let roleNames: string[] = [];
  if (roleIds.length > 0) {
    const allRoles = await db.query.roles.findMany({
      where: (r, { and, eq: eqOp }) => and(eqOp(r.tenantId, tenantId)),
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
