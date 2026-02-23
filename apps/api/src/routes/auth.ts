import { Elysia } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import {
  getGitHubAuthUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  FRONTEND_URL,
} from "../lib/github-oauth";
import {
  createSession,
  deleteSession,
  buildCookieHeader,
  SESSION_COOKIE_NAME,
} from "../lib/session";
import { findOrCreateUserFromGitHub } from "../services/auth.service";
import { optionalAuth } from "../middleware/auth";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "auth-routes" });

// ── Server-side OAuth state store (avoids cookie issues with Vercel rewrites) ──

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingStates = new Map<string, number>(); // state → expiry timestamp

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function storeState(state: string): void {
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  // Prune expired entries periodically
  if (pendingStates.size > 100) {
    const now = Date.now();
    for (const [k, exp] of pendingStates) {
      if (exp < now) pendingStates.delete(k);
    }
  }
}

function consumeState(state: string): boolean {
  const expiry = pendingStates.get(state);
  if (!expiry) return false;
  pendingStates.delete(state);
  return Date.now() < expiry;
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function redirect(set: any, url: string, extraHeaders?: Record<string, string | string[]>) {
  set.status = 302;
  set.headers["Location"] = url;
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      set.headers[k] = v;
    }
  }
}

export function authRoutes(db: Db) {
  return new Elysia({ prefix: "/auth" })
    .get("/github", ({ set }) => {
      const state = generateState();
      storeState(state);
      log.info("initiating GitHub OAuth flow");
      redirect(set, getGitHubAuthUrl(state));
    })

    .get("/github/callback", async ({ request, set }) => {
      try {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // GitHub may redirect with an error (e.g. user denied access)
        if (error) {
          log.warn({ error }, "GitHub OAuth returned error");
          redirect(set, `${FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
          return;
        }

        // Verify state against server-side store
        if (!state || !consumeState(state)) {
          log.warn({ state: state ?? "(missing)" }, "OAuth state mismatch or expired");
          redirect(set, `${FRONTEND_URL}/login?error=invalid_state`);
          return;
        }

        if (!code) {
          log.warn("OAuth callback missing code");
          redirect(set, `${FRONTEND_URL}/login?error=missing_code`);
          return;
        }

        // Exchange code for token + fetch user
        log.info("exchanging OAuth code for token");
        const accessToken = await exchangeCodeForToken(code);
        const ghUser = await fetchGitHubUser(accessToken);
        log.info({ githubLogin: ghUser.login, githubId: ghUser.id }, "fetched GitHub user");

        // Find or create user (also auto-creates connector + syncs repos)
        const { userId, tenantId } = await findOrCreateUserFromGitHub(
          db,
          ghUser,
          accessToken,
        );
        log.info({ userId, tenantId, githubLogin: ghUser.login }, "user authenticated");

        // Create session
        const sessionToken = await createSession({ userId, tenantId });

        // Redirect to frontend with session cookie
        return new Response(null, {
          status: 302,
          headers: [
            ["Location", FRONTEND_URL],
            ["Set-Cookie", buildCookieHeader(sessionToken)],
          ],
        });
      } catch (err) {
        log.error({ err }, "OAuth callback error");
        redirect(set, `${FRONTEND_URL}/login?error=auth_failed`);
      }
    })

    .use(optionalAuth)
    .post("/logout", async ({ request, set }) => {
      const cookieHeader = request.headers.get("cookie");
      const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
      if (token) {
        await deleteSession(token);
        log.info("user logged out, session deleted");
      }
      set.headers["Set-Cookie"] = buildCookieHeader(undefined, true);
      return { ok: true };
    });
}
