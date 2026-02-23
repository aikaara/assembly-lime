import { completeSimple, getModel } from "@assembly-lime/pi-ai";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { logger } from "../lib/logger";

type RepoCandidate = NonNullable<AgentJobPayload["repos"]>[number];

type SelectionResult = {
  selected: RepoCandidate;
  reasoning: string;
};

const MAX_CANDIDATES = 30;

const SYSTEM_PROMPT = `You are a repository selector. Given a task description and a list of candidate repositories, pick the single best repository for the task.

Respond with ONLY a JSON object — no markdown, no explanation outside the JSON:
{"index": <0-based index>, "reasoning": "<one sentence>"}`;

/**
 * Derive owner/name from cloneUrl when the API didn't populate them.
 * e.g. "https://github.com/acme/backend.git" → { owner: "acme", name: "backend" }
 */
function deriveOwnerName(repo: RepoCandidate): { owner: string; name: string; fullName: string } {
  if (repo.owner && repo.name) {
    return { owner: repo.owner, name: repo.name, fullName: repo.fullName || `${repo.owner}/${repo.name}` };
  }
  try {
    const url = new URL(repo.cloneUrl);
    const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[segments.length - 2]!;
      const name = segments[segments.length - 1]!;
      return { owner, name, fullName: `${owner}/${name}` };
    }
  } catch {}
  return { owner: "unknown", name: `repo-${repo.repositoryId}`, fullName: `unknown/repo-${repo.repositoryId}` };
}

function buildUserPrompt(
  repos: RepoCandidate[],
  taskPrompt: string,
  mode: string,
): string {
  const catalog = repos
    .map((r, i) => {
      const { fullName } = deriveOwnerName(r);
      const parts = [`${i}. ${fullName}`];
      if (r.roleLabel) parts.push(`role=${r.roleLabel}`);
      if (r.isPrimary) parts.push("(primary)");
      if (r.notes) parts.push(`notes: ${r.notes}`);
      return parts.join(" | ");
    })
    .join("\n");

  return `Mode: ${mode}
Task: ${taskPrompt}

Repositories:
${catalog}`;
}

export async function selectRepo(
  repos: RepoCandidate[],
  taskPrompt: string,
  mode: string,
): Promise<SelectionResult> {
  const log = logger.child({ module: "repo-selector" });

  // Enrich all candidates with derived owner/name (backwards compat with old API)
  for (const r of repos) {
    const derived = deriveOwnerName(r);
    if (!r.owner) r.owner = derived.owner;
    if (!r.name) r.name = derived.name;
    if (!r.fullName) r.fullName = derived.fullName;
  }

  // Single repo — skip LLM
  if (repos.length === 1) {
    return { selected: repos[0]!, reasoning: "only candidate" };
  }

  // Pre-filter candidates by keyword relevance from the task prompt
  let candidates = repos;
  if (repos.length > MAX_CANDIDATES) {
    // Extract meaningful keywords from the prompt (3+ chars, lowercase)
    const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "have", "are", "was", "will", "can", "not", "but", "all", "been", "has", "had", "its", "they", "how", "what", "explain", "describe", "create", "update", "implement", "add", "fix", "bug", "feature", "please", "structure", "help"]);
    const keywords = taskPrompt
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    // Score each repo by keyword matches against name/fullName
    const scored = repos.map((r) => {
      const haystack = `${r.fullName ?? ""} ${r.name} ${r.owner}`.toLowerCase();
      let score = 0;
      if (r.isPrimary) score += 100;
      if (r.roleLabel) score += 50;
      for (const kw of keywords) {
        if (haystack.includes(kw)) score += 10;
      }
      return { repo: r, score };
    });

    // Sort by score descending, take top MAX_CANDIDATES
    scored.sort((a, b) => b.score - a.score);
    candidates = scored.slice(0, MAX_CANDIDATES).map((s) => s.repo);

    const matchedCount = scored.filter((s) => s.score > 0).length;
    log.info({
      total: repos.length,
      cap: MAX_CANDIDATES,
      keywords: keywords.slice(0, 10),
      matchedCount,
    }, "pre-filtered repo candidates by keyword relevance");
  }

  try {
    const model = getModel("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");

    const result = await completeSimple(model, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(candidates, taskPrompt, mode),
          timestamp: Date.now(),
        },
      ],
    }, {
      maxTokens: 256,
      temperature: 0,
    });

    // Extract text from response
    const text = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Parse JSON from response (tolerate markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error(`no JSON in response: ${text}`);

    const parsed = JSON.parse(jsonMatch[0]) as { index: number; reasoning: string };
    const idx = parsed.index;

    if (typeof idx !== "number" || idx < 0 || idx >= candidates.length) {
      throw new Error(`invalid index ${idx} for ${candidates.length} repos`);
    }

    log.info({ selectedIndex: idx, reasoning: parsed.reasoning, repoName: candidates[idx]!.fullName }, "LLM selected repo");
    return { selected: candidates[idx]!, reasoning: parsed.reasoning };
  } catch (err) {
    log.warn({ err }, "LLM repo selection failed, using fallback");

    // Fallback: prefer isPrimary repo, then first in list
    const primary = repos.find((r) => r.isPrimary);
    const fallback = primary ?? repos[0]!;
    return {
      selected: fallback,
      reasoning: `fallback: ${primary ? "isPrimary flag" : "first in list"}`,
    };
  }
}
