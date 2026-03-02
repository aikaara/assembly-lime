import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  searchCode,
  getIndexStatuses,
  triggerReindex,
  triggerReindexAll,
} from "../services/code-search.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "code-search-routes" });

export function codeSearchRoutes(db: Db) {
  return new Elysia({ prefix: "/code-search" })
    .use(requireAuth)
    .post(
      "/search",
      async ({ auth, body }) => {
        const results = await searchCode(db, auth!.tenantId, body.query, {
          repositoryId: body.repositoryId ? Number(body.repositoryId) : undefined,
          language: body.language,
          chunkType: body.chunkType,
          limit: body.limit ? Number(body.limit) : undefined,
        });
        return { results };
      },
      {
        body: t.Object({
          query: t.String(),
          repositoryId: t.Optional(t.String()),
          language: t.Optional(t.String()),
          chunkType: t.Optional(t.String()),
          limit: t.Optional(t.Number()),
        }),
      }
    )
    .get(
      "/status",
      async ({ auth }) => {
        const statuses = await getIndexStatuses(db, auth!.tenantId);
        return { statuses };
      }
    )
    .post(
      "/reindex/:repositoryId",
      async ({ auth, params }) => {
        const result = await triggerReindex(
          db,
          auth!.tenantId,
          Number(params.repositoryId),
        );
        return result;
      },
      {
        params: t.Object({ repositoryId: t.String() }),
      }
    )
    .post(
      "/reindex-all",
      async ({ auth }) => {
        const result = await triggerReindexAll(db, auth!.tenantId);
        return result;
      }
    );
}
