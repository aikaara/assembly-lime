import { redis } from "./redis";

export const SESSION_COOKIE_NAME = "al_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const SESSION_PREFIX = "session:";

type SessionData = { userId: number; tenantId: number };

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(data: SessionData): Promise<string> {
  const token = generateToken();
  await redis.set(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify(data),
    "EX",
    SESSION_TTL_SEC,
  );
  return token;
}

export async function getSession(token: string): Promise<SessionData | null> {
  const raw = await redis.get(`${SESSION_PREFIX}${token}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(token: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${token}`);
}

export function buildCookieHeader(token?: string, clear?: boolean): string {
  if (clear) {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`;
}
