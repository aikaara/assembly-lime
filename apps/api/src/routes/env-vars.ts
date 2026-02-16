import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  createEnvVarSet,
  listEnvVarSets,
  getEnvVarSet,
  deleteEnvVarSet,
  setEnvVar,
  setEnvVarsBulk,
  listEnvVars,
  deleteEnvVar,
} from "../services/env-var.service";

function serializeSet(r: any) {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId),
    scopeType: r.scopeType,
    scopeId: String(r.scopeId),
    name: r.name,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

function serializeVar(r: any) {
  return {
    id: String(r.id),
    key: r.key,
    isSecret: r.isSecret,
    hasValue: r.hasValue ?? true,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

export function envVarRoutes(db: Db) {
  return new Elysia({ prefix: "/env-var-sets" })
    .use(requireAuth)
    // Create a new env var set
    .post(
      "/",
      async ({ auth, body }) => {
        const row = await createEnvVarSet(db, auth!.tenantId, {
          scopeType: body.scopeType,
          scopeId: body.scopeId,
          name: body.name,
        });
        return serializeSet(row);
      },
      {
        body: t.Object({
          scopeType: t.String({ minLength: 1 }),
          scopeId: t.Number(),
          name: t.String({ minLength: 1 }),
        }),
      },
    )
    // List env var sets (optionally filtered by scope)
    .get(
      "/",
      async ({ auth, query }) => {
        const scopeType = query.scopeType || undefined;
        const scopeId = query.scopeId ? Number(query.scopeId) : undefined;
        const rows = await listEnvVarSets(db, auth!.tenantId, scopeType, scopeId);
        return rows.map(serializeSet);
      },
      {
        query: t.Object({
          scopeType: t.Optional(t.String()),
          scopeId: t.Optional(t.String()),
        }),
      },
    )
    // Get a single env var set with its vars (metadata only, values masked)
    .get(
      "/:id",
      async ({ auth, params }) => {
        const set = await getEnvVarSet(db, auth!.tenantId, Number(params.id));
        if (!set) return { error: "not found" };
        const vars = await listEnvVars(db, auth!.tenantId, set.id);
        return { ...serializeSet(set), vars: vars.map(serializeVar) };
      },
      { params: t.Object({ id: t.String() }) },
    )
    // Delete an env var set (cascades to vars)
    .delete(
      "/:id",
      async ({ auth, params, set: setFn }) => {
        const row = await deleteEnvVarSet(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return { id: String(row.id), deleted: true };
      },
      { params: t.Object({ id: t.String() }) },
    )
    // List vars in a set (keys + metadata, no values)
    .get(
      "/:id/vars",
      async ({ auth, params }) => {
        const vars = await listEnvVars(db, auth!.tenantId, Number(params.id));
        return vars.map(serializeVar);
      },
      { params: t.Object({ id: t.String() }) },
    )
    // Set a single var (upsert)
    .post(
      "/:id/vars",
      async ({ auth, params, body }) => {
        const set = await getEnvVarSet(db, auth!.tenantId, Number(params.id));
        if (!set) return { error: "env var set not found" };
        const row = await setEnvVar(
          db,
          auth!.tenantId,
          set.id,
          body.key,
          body.value,
          body.isSecret ?? true,
        );
        return serializeVar({ ...row, hasValue: true });
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          key: t.String({ minLength: 1 }),
          value: t.String(),
          isSecret: t.Optional(t.Boolean()),
        }),
      },
    )
    // Bulk set vars
    .post(
      "/:id/vars/bulk",
      async ({ auth, params, body }) => {
        const set = await getEnvVarSet(db, auth!.tenantId, Number(params.id));
        if (!set) return { error: "env var set not found" };
        const rows = await setEnvVarsBulk(db, auth!.tenantId, set.id, body.vars);
        return rows.map((r) => serializeVar({ ...r, hasValue: true }));
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          vars: t.Array(
            t.Object({
              key: t.String({ minLength: 1 }),
              value: t.String(),
              isSecret: t.Optional(t.Boolean()),
            }),
          ),
        }),
      },
    )
    // Delete a specific var
    .delete(
      "/:id/vars/:varId",
      async ({ auth, params }) => {
        const row = await deleteEnvVar(db, auth!.tenantId, Number(params.varId));
        if (!row) return { error: "not found" };
        return { id: String(row.id), deleted: true };
      },
      {
        params: t.Object({ id: t.String(), varId: t.String() }),
      },
    );
}
