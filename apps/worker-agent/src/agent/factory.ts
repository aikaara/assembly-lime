import { Agent } from "@assembly-lime/pi-agent";
import { getEnvApiKey } from "@assembly-lime/pi-ai";
import type { AgentMode, AgentProviderId } from "@assembly-lime/shared";
import type { AgentTool, ThinkingLevel } from "@assembly-lime/pi-agent";
import { resolveModel } from "./model-resolver";
import { convertToLlm } from "./convert-to-llm";

function resolveThinkingLevel(mode: AgentMode): ThinkingLevel {
  return mode === "plan" ? "medium" : "low";
}

export interface CreateAgentOpts {
  providerId: AgentProviderId;
  mode: AgentMode;
  systemPrompt: string;
  tools: AgentTool<any>[];
}

export function createAgent(opts: CreateAgentOpts): Agent {
  const model = resolveModel(opts.providerId);
  const thinkingLevel = resolveThinkingLevel(opts.mode);

  return new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model,
      thinkingLevel,
      tools: opts.tools,
      messages: [],
    },
    convertToLlm,
    getApiKey: (provider) => getEnvApiKey(provider),
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  });
}
