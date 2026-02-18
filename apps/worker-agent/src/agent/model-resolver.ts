import { getModel, type Model } from "@assembly-lime/pi-ai";
import type { AgentProviderId } from "@assembly-lime/shared";

const MODEL_MAP: Record<AgentProviderId, { provider: string; modelId: string }> = {
  claude: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  codex: { provider: "openai", modelId: "gpt-4o" },
};

export function resolveModel(providerId: AgentProviderId): Model<any> {
  const entry = MODEL_MAP[providerId];
  return getModel(entry.provider, entry.modelId);
}
