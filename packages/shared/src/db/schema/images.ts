import {
  pgTable,
  bigint,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { agentRuns } from "./agents";
import { tickets } from "./projects";

export const images = pgTable(
  "images",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    agentRunId: bigint("agent_run_id", { mode: "number" }).references(
      () => agentRuns.id,
      { onDelete: "set null" }
    ),
    ticketId: bigint("ticket_id", { mode: "number" }).references(
      () => tickets.id,
      { onDelete: "set null" }
    ),
    s3Key: text("s3_key").notNull(),
    s3Bucket: text("s3_bucket").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    purpose: text("purpose"),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("images_tenant_run_idx").on(t.tenantId, t.agentRunId),
    index("images_tenant_ticket_idx").on(t.tenantId, t.ticketId),
    index("images_tenant_created_idx").on(t.tenantId, t.createdAt),
  ]
);
