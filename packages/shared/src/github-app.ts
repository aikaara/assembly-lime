import { createSign } from "crypto";
import { readFileSync } from "fs";

// ── Types ──────────────────────────────────────────────────────────────

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
}

interface InstallationToken {
  token: string;
  expiresAt: Date;
}

// ── In-memory cache for installation IDs ───────────────────────────────

const installationIdCache = new Map<string, number>();

// ── Config helpers ─────────────────────────────────────────────────────

/**
 * Read GitHub App config from env vars. Returns null if not configured.
 *
 * Env vars:
 *  - GITHUB_APP_ID (required)
 *  - GITHUB_APP_PRIVATE_KEY — inline PEM or base64-encoded PEM
 *  - GITHUB_APP_PRIVATE_KEY_PATH — path to PEM file (fallback if inline not set)
 *  - GITHUB_APP_INSTALLATION_ID — optional, auto-detected from repo owner if omitted
 */
export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) return null;

  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!privateKey) {
    const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (keyPath) {
      try {
        privateKey = readFileSync(keyPath, "utf-8");
      } catch {
        return null;
      }
    }
  }

  if (!privateKey) return null;

  // Handle escaped newlines (e.g. from Docker/K8s env injection)
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  // Handle base64-encoded PEM
  if (!privateKey.startsWith("-----BEGIN")) {
    try {
      const decoded = Buffer.from(privateKey, "base64").toString("utf-8");
      if (decoded.startsWith("-----BEGIN")) {
        privateKey = decoded;
      }
    } catch {
      // not base64, use as-is
    }
  }

  return {
    appId,
    privateKey,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID || undefined,
  };
}

export function isGitHubAppConfigured(): boolean {
  return getGitHubAppConfig() !== null;
}

// ── JWT generation ─────────────────────────────────────────────────────

function generateJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: appId,
    iat: now - 60, // 60s clock drift allowance
    exp: now + 600, // 10 minute expiry (max allowed)
  };

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const segments = `${b64url(header)}.${b64url(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(segments);
  const signature = sign.sign(privateKey, "base64url");

  return `${segments}.${signature}`;
}

// ── Installation ID lookup ─────────────────────────────────────────────

const ghHeaders = (jwt: string) => ({
  Authorization: `Bearer ${jwt}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function lookupInstallationId(jwt: string, owner: string): Promise<number> {
  const cached = installationIdCache.get(owner);
  if (cached) return cached;

  // 1. Try owner-specific endpoint (org then user)
  for (const kind of ["orgs", "users"] as const) {
    const url = `https://api.github.com/${kind}/${owner}/installation`;
    const res = await fetch(url, { headers: ghHeaders(jwt) });

    if (res.ok) {
      const data = (await res.json()) as { id: number };
      installationIdCache.set(owner, data.id);
      return data.id;
    }

    // 401 means the JWT itself is invalid (bad app ID or private key)
    if (res.status === 401) {
      const body = await res.text();
      throw new Error(`GitHub App JWT authentication failed (${res.status}): ${body}. Check GITHUB_APP_ID and private key.`);
    }
  }

  // 2. Fallback: list all installations and match by account login
  const listRes = await fetch("https://api.github.com/app/installations", { headers: ghHeaders(jwt) });
  if (listRes.ok) {
    const installations = (await listRes.json()) as Array<{ id: number; account: { login: string } }>;
    const match = installations.find(
      (i) => i.account?.login?.toLowerCase() === owner.toLowerCase(),
    );
    if (match) {
      installationIdCache.set(owner, match.id);
      return match.id;
    }

    // App works but isn't installed on this owner — show where it IS installed
    const installed = installations.map((i) => i.account?.login).filter(Boolean);
    throw new Error(
      `GitHub App is not installed for "${owner}". ` +
      (installed.length > 0
        ? `Currently installed on: ${installed.join(", ")}. `
        : "Not installed on any account. ") +
      `Install at: https://github.com/apps/<your-app-name>/installations/new`,
    );
  }

  // 3. list endpoint also failed — likely a JWT issue
  const listBody = await listRes.text();
  throw new Error(
    `GitHub App authentication failed (${listRes.status}): ${listBody}. Check GITHUB_APP_ID and private key.`,
  );
}

// ── Installation token generation ──────────────────────────────────────

/**
 * Generate a fresh GitHub App installation token for a given repo owner.
 *
 * Flow:
 *  1. Create a JWT signed with the App's private key
 *  2. Look up the installation ID for the owner (org or user)
 *  3. POST to create an installation access token
 *  4. Return { token, expiresAt }
 *
 * The token is valid for ~1 hour. Use "x-access-token" as the username
 * for HTTPS git operations.
 */
export async function generateInstallationToken(repoOwner: string): Promise<InstallationToken> {
  const config = getGitHubAppConfig();
  if (!config) {
    throw new Error("GitHub App is not configured — set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH");
  }

  const jwt = generateJwt(config.appId, config.privateKey);

  // Resolve installation ID
  let installationId: number;
  if (config.installationId) {
    installationId = parseInt(config.installationId, 10);
  } else {
    installationId = await lookupInstallationId(jwt, repoOwner);
  }

  // Create installation access token
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create installation token (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };

  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
}
