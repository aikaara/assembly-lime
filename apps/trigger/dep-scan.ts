import { task, logger } from "@trigger.dev/sdk/v3";
import { createDb } from "@assembly-lime/shared/db";
import { scanAllDependencies } from "../api/src/services/dependency-scanner.service";

export const depScanTask = task({
  id: "dep-scan",
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async (payload: { tenantId: number }) => {
    logger.info("dependency scan started", { tenantId: payload.tenantId });

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required for dep-scan");
    }
    const db = createDb(databaseUrl);

    const jobLog = async (message: string) => {
      logger.info(message);
    };

    const updateProgress = async (pct: number) => {
      logger.info(`scan progress: ${pct}%`);
    };

    await scanAllDependencies(db, payload.tenantId, jobLog, updateProgress);

    logger.info("dependency scan finished", { tenantId: payload.tenantId });
  },
});
