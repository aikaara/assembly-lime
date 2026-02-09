import { Elysia } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import {
  getGitHubAuthUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
} from "../lib/github-oauth";
import {
  createSession,
  deleteSession,
  buildCookieHeader,
  SESSION_COOKIE_NAME,
} from "../lib/session";
import { findOrCreateUserFromGitHub } from "../services/auth.service";
import { optionalAuth } from "../middleware/auth";

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export function authRoutes(db: Db) {
  return new Elysia({ prefix: "/auth" })
    .get("/github", ({ set }) => {
      const state = generateState();
      const stateCookie = `al_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
      set.headers["Set-Cookie"] = stateCookie;
      set.redirect = getGitHubAuthUrl(state);
    })

    .get("/github/callback", async ({ request, set }) => {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      // Verify state
      const cookieHeader = request.headers.get("cookie");
      const savedState = parseCookie(cookieHeader, "al_oauth_state");
      if (!state || !savedState || state !== savedState) {
        set.status = 400;
        return { error: "Invalid OAuth state" };
      }

      if (!code) {
        set.status = 400;
        return { error: "Missing code parameter" };
      }

      // Exchange code for token + fetch user
      const accessToken = await exchangeCodeForToken(code);
      const ghUser = await fetchGitHubUser(accessToken);

      // Find or create user
      const { userId, tenantId } = await findOrCreateUserFromGitHub(
        db,
        ghUser,
      );

      // Create session
      const sessionToken = await createSession({ userId, tenantId });

      // Clear oauth state cookie + set session cookie
      const clearState =
        "al_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
      set.headers["Set-Cookie"] = [
        clearState,
        buildCookieHeader(sessionToken),
      ] as any;
      set.redirect = "/";
    })

    .use(optionalAuth)
    .post("/logout", async ({ request, set }) => {
      const cookieHeader = request.headers.get("cookie");
      const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
      if (token) {
        await deleteSession(token);
      }
      set.headers["Set-Cookie"] = buildCookieHeader(undefined, true);
      return { ok: true };
    });
}
