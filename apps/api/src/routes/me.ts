import { Elysia } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import { getCurrentUser } from "../services/auth.service";

export function meRoutes(db: Db) {
  return new Elysia()
    .use(requireAuth)
    .get("/me", async ({ auth }) => {
      const me = await getCurrentUser(db, auth!.userId, auth!.tenantId);
      if (!me) {
        return { error: "User not found" };
      }
      return me;
    });
}
