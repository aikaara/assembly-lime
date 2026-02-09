import { defineConfig } from "drizzle-kit";
import path from "path";

const configDir = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  schema: path.resolve(configDir, "../../packages/shared/src/db/schema/*.ts"),
  out: path.resolve(configDir, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
