import { createDb } from "@assembly-lime/shared/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const db = createDb(databaseUrl);
