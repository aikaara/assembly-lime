import {
  pgTable,
  bigint,
  text,
  integer,
  timestamp,
  customType,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { repositories } from "./connectors";

// pgvector extension — applied via db:push alongside citext/pgcrypto
// sql`CREATE EXTENSION IF NOT EXISTS vector`

const vector768 = customType<{ data: number[] }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown) {
    if (typeof value === "string") {
      return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map(Number);
    }
    return value as number[];
  },
});

export const codeChunks = pgTable(
  "code_chunks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    chunkType: text("chunk_type").notNull(),
    symbolName: text("symbol_name"),
    language: text("language").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    contextHeader: text("context_header"),
    embedding: vector768("embedding"),
    commitSha: text("commit_sha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("code_chunks_tenant_repo_idx").on(t.tenantId, t.repositoryId),
    index("code_chunks_tenant_file_idx").on(t.tenantId, t.filePath),
    index("code_chunks_tenant_symbol_idx")
      .on(t.tenantId, t.symbolName)
      .where(sql`symbol_name IS NOT NULL`),
    // HNSW index for vector similarity search
    // Note: This requires CREATE EXTENSION vector; to be run first
    // Drizzle doesn't support HNSW index syntax directly, so we create it via raw SQL in migration
  ]
);

export const repoIndexStatus = pgTable(
  "repo_index_status",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    lastIndexedSha: text("last_indexed_sha"),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    fileCount: integer("file_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repo_index_status_tenant_repo_uniq").on(t.tenantId, t.repositoryId),
  ]
);
