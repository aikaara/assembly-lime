import { eq, gt, and, lt } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { sessions } from "@assembly-lime/shared/db/schema";

export const SESSION_COOKIE_NAME = "al_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

type SessionData = { userId: number; tenantId: number };

let _db: Db;

export function initSessionStore(db: Db) {
  _db = db;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(data: SessionData): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);
  await _db.insert(sessions).values({
    token,
    userId: data.userId,
    tenantId: data.tenantId,
    expiresAt,
  });
  return token;
}

export async function getSession(token: string): Promise<SessionData | null> {
  const [row] = await _db
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await _db.delete(sessions).where(eq(sessions.token, token));
}

export async function pruneExpiredSessions(): Promise<void> {
  await _db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function buildCookieHeader(token?: string, clear?: boolean): string {
  if (clear) {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`;
}
