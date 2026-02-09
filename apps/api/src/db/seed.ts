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

  const tenantId = tenant?.id;
  if (!tenantId) {
    console.log("Dev tenant already exists, looking up...");
    const existing = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, "dev"),
    });
    if (!existing) throw new Error("Failed to find or create dev tenant");
    await seedRoles(existing.id);
    return;
  }

  await seedRoles(tenantId);
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
  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
