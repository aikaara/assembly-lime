import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { envVarSets, envVars } from "@assembly-lime/shared/db/schema";
import { encryptToken, decryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "env-var-service" });

// ── Env Var Sets ──────────────────────────────────────────────────────

export async function createEnvVarSet(
  db: Db,
  tenantId: number,
  input: { scopeType: string; scopeId: number; name: string },
) {
  const [row] = await db
    .insert(envVarSets)
    .values({
      tenantId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name,
    })
    .returning();
  log.info({ setId: row!.id, tenantId, scope: `${input.scopeType}:${input.scopeId}` }, "env var set created");
  return row!;
}

export async function listEnvVarSets(
  db: Db,
  tenantId: number,
  scopeType?: string,
  scopeId?: number,
) {
  if (scopeType && scopeId !== undefined) {
    return db
      .select()
      .from(envVarSets)
      .where(
        and(
          eq(envVarSets.tenantId, tenantId),
          eq(envVarSets.scopeType, scopeType),
          eq(envVarSets.scopeId, scopeId),
        ),
      );
  }
  return db.select().from(envVarSets).where(eq(envVarSets.tenantId, tenantId));
}

export async function getEnvVarSet(db: Db, tenantId: number, setId: number) {
  const [row] = await db
    .select()
    .from(envVarSets)
    .where(and(eq(envVarSets.id, setId), eq(envVarSets.tenantId, tenantId)));
  return row ?? null;
}

export async function deleteEnvVarSet(db: Db, tenantId: number, setId: number) {
  const [row] = await db
    .delete(envVarSets)
    .where(and(eq(envVarSets.id, setId), eq(envVarSets.tenantId, tenantId)))
    .returning();
  if (row) {
    log.info({ setId, tenantId }, "env var set deleted (vars cascade-deleted)");
  }
  return row ?? null;
}

// ── Env Vars ──────────────────────────────────────────────────────────

/** Upsert a single env var (encrypt value at rest). */
export async function setEnvVar(
  db: Db,
  tenantId: number,
  setId: number,
  key: string,
  value: string,
  isSecret = true,
) {
  const valueEnc = encryptToken(value);

  const [row] = await db
    .insert(envVars)
    .values({ tenantId, setId, key, valueEnc, isSecret })
    .onConflictDoUpdate({
      target: [envVars.tenantId, envVars.setId, envVars.key],
      set: { valueEnc, isSecret },
    })
    .returning();
  log.info({ varId: row!.id, key, setId, tenantId }, "env var set/updated");
  return row!;
}

/** Bulk upsert: set multiple vars at once. */
export async function setEnvVarsBulk(
  db: Db,
  tenantId: number,
  setId: number,
  vars: Array<{ key: string; value: string; isSecret?: boolean }>,
) {
  const results = [];
  for (const v of vars) {
    const row = await setEnvVar(db, tenantId, setId, v.key, v.value, v.isSecret ?? true);
    results.push(row);
  }
  return results;
}

/** List vars in a set — returns metadata only, values are masked. */
export async function listEnvVars(db: Db, tenantId: number, setId: number) {
  const rows = await db
    .select({
      id: envVars.id,
      key: envVars.key,
      isSecret: envVars.isSecret,
      createdAt: envVars.createdAt,
    })
    .from(envVars)
    .where(and(eq(envVars.tenantId, tenantId), eq(envVars.setId, setId)));

  return rows.map((r) => ({
    ...r,
    hasValue: true, // all stored vars have a value
  }));
}

/** Get decrypted key/value pairs — internal use only (sandbox creation, agent runs). */
export async function getDecryptedEnvVars(
  db: Db,
  tenantId: number,
  setId: number,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: envVars.key, valueEnc: envVars.valueEnc })
    .from(envVars)
    .where(and(eq(envVars.tenantId, tenantId), eq(envVars.setId, setId)));

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = decryptToken(row.valueEnc);
  }
  return result;
}

export async function deleteEnvVar(db: Db, tenantId: number, varId: number) {
  const [row] = await db
    .delete(envVars)
    .where(and(eq(envVars.id, varId), eq(envVars.tenantId, tenantId)))
    .returning();
  if (row) {
    log.info({ varId, tenantId }, "env var deleted");
  }
  return row ?? null;
}

// ── Auto-create from detected keys ───────────────────────────────────

/**
 * Given detected env keys from a repo scan, create an env_var_set with
 * placeholder entries for each key (empty encrypted values).
 * Users fill in real values via the UI.
 */
export async function autoCreateFromDetectedKeys(
  db: Db,
  tenantId: number,
  scopeType: string,
  scopeId: number,
  repoName: string,
  keys: string[],
) {
  if (keys.length === 0) return null;

  // Check if a set already exists for this scope
  const existing = await db
    .select()
    .from(envVarSets)
    .where(
      and(
        eq(envVarSets.tenantId, tenantId),
        eq(envVarSets.scopeType, scopeType),
        eq(envVarSets.scopeId, scopeId),
        eq(envVarSets.name, repoName),
      ),
    );

  let setRow;
  if (existing.length > 0) {
    setRow = existing[0]!;
  } else {
    [setRow] = await db
      .insert(envVarSets)
      .values({
        tenantId,
        scopeType,
        scopeId,
        name: repoName,
      })
      .returning();
  }

  // Insert placeholder vars for detected keys (skip if already exists)
  for (const key of keys) {
    const existingVar = await db
      .select({ id: envVars.id })
      .from(envVars)
      .where(
        and(
          eq(envVars.tenantId, tenantId),
          eq(envVars.setId, setRow!.id),
          eq(envVars.key, key),
        ),
      );
    if (existingVar.length === 0) {
      // Store empty placeholder (encrypted empty string)
      const valueEnc = encryptToken("");
      await db.insert(envVars).values({
        tenantId,
        setId: setRow!.id,
        key,
        valueEnc,
        isSecret: true,
      });
    }
  }

  log.info(
    { setId: setRow!.id, tenantId, keys: keys.length, scope: `${scopeType}:${scopeId}` },
    "auto-created env var set from detected keys",
  );
  return setRow;
}
