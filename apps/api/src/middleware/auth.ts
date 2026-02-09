import Elysia from "elysia";
import { SESSION_COOKIE_NAME, getSession } from "../lib/session";

export type AuthContext = { userId: number; tenantId: number };

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

async function resolveAuth(request: Request): Promise<AuthContext | null> {
  const cookieHeader = request.headers.get("cookie");
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await getSession(token);
  return session;
}

export const requireAuth = new Elysia({ name: "require-auth" })
  .derive({ as: "scoped" }, async ({ request, set }): Promise<{ auth: AuthContext }> => {
    const auth = await resolveAuth(request);
    if (!auth) {
      set.status = 401;
      throw new Error("Unauthorized");
    }
    return { auth };
  });

export const optionalAuth = new Elysia({ name: "optional-auth" })
  .derive({ as: "scoped" }, async ({ request }): Promise<{ auth: AuthContext | null }> => {
    const auth = await resolveAuth(request);
    return { auth };
  });
