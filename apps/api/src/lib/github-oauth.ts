const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const API_URL = process.env.API_URL ?? "http://localhost:3434";

export const FRONTEND_URL = process.env.APP_URL ?? "http://localhost:5173";

export function getGitHubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${API_URL}/auth/github/callback`,
    scope: "read:user user:email repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error ?? "unknown"}`);
  }
  return data.access_token;
}

export type GitHubUser = {
  id: number;
  login: string;
  email: string;
  name: string | null;
  avatar_url: string;
};

export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUser> {
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ]);

  const user = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    email: string | null;
  };

  let email = user.email;
  if (!email) {
    const emailsBody = await emailsRes.json();
    const emails = Array.isArray(emailsBody)
      ? (emailsBody as Array<{ email: string; primary: boolean; verified: boolean }>)
      : [];
    const primary = emails.find((e) => e.primary && e.verified);
    email = primary?.email ?? emails[0]?.email ?? `${user.login}@users.noreply.github.com`;
  }

  return {
    id: user.id,
    login: user.login,
    email,
    name: user.name,
    avatar_url: user.avatar_url,
  };
}
