import { pgTable, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  forkTargetOrg: text("fork_target_org"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
