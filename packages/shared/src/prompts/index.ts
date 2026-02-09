import type { AgentMode, AgentProviderId } from "../protocol";
import { PROVIDER_PREAMBLES, MODE_PROMPTS } from "./base-prompts";

export { PROVIDER_PREAMBLES, MODE_PROMPTS } from "./base-prompts";

export type InstructionLayer = {
  scope: string;
  content: string;
  priority: number;
};

export type ResolvePromptInput = {
  provider: AgentProviderId;
  mode: AgentMode;
  instructionLayers: InstructionLayer[];
  userPrompt: string;
};

/**
 * Combines provider preamble, mode prompt, DB instruction layers (sorted by
 * priority), and the user's prompt into a single resolved system prompt.
 *
 * Instruction resolution order (per CLAUDE.md):
 *  1. Provider preamble (built-in)
 *  2. Mode prompt (built-in)
 *  3. default_agent_instructions (tenant + provider)
 *  4. custom_instructions — tenant scope
 *  5. custom_instructions — project scope
 *  6. custom_instructions — repository scope
 *  7. custom_instructions — ticket scope
 *  8. User prompt
 */
export function resolvePrompt(input: ResolvePromptInput): string {
  const parts: string[] = [];

  // 1. Provider preamble
  parts.push(PROVIDER_PREAMBLES[input.provider]);

  // 2. Mode-specific prompt
  parts.push(MODE_PROMPTS[input.mode]);

  // 3-7. DB instruction layers (already sorted by scope/priority from the resolver)
  const sorted = [...input.instructionLayers].sort(
    (a, b) => a.priority - b.priority
  );
  for (const layer of sorted) {
    parts.push(`## Instructions (${layer.scope})\n\n${layer.content}`);
  }

  // 8. User prompt
  parts.push(`## User Request\n\n${input.userPrompt}`);

  return parts.join("\n\n---\n\n");
}
