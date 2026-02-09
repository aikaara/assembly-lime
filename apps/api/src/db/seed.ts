import { createDb, schema } from "@assembly-lime/shared/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const db = createDb(databaseUrl);

async function seed() {
  console.log("Seeding database...");

  // Insert dev tenant
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Dev Tenant", slug: "dev" })
    .onConflictDoNothing()
    .returning();

  let resolvedTenantId = tenant?.id;
  if (!resolvedTenantId) {
    console.log("Dev tenant already exists, looking up...");
    const existing = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, "dev"),
    });
    if (!existing) throw new Error("Failed to find or create dev tenant");
    resolvedTenantId = existing.id;
  }

  await seedRoles(resolvedTenantId);
  await seedProject(resolvedTenantId);
}

async function seedRoles(tenantId: number) {
  const roleNames = ["admin", "pm", "dev", "qa"];

  for (const name of roleNames) {
    await db
      .insert(schema.roles)
      .values({ tenantId, name, permissionsJson: {} })
      .onConflictDoNothing();
  }

  console.log(`Seeded roles: ${roleNames.join(", ")} for tenant ${tenantId}`);
}

async function seedProject(tenantId: number) {
  await db
    .insert(schema.projects)
    .values({ tenantId, name: "Dev Project", key: "DEV" })
    .onConflictDoNothing();

  console.log(`Seeded project "Dev Project" for tenant ${tenantId}`);
  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
