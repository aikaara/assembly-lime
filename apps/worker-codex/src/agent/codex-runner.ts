import OpenAI from "openai";
import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { logger } from "../lib/logger";

const openai = new OpenAI();

export async function runCodexAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
): Promise<void> {
  const log = logger.child({ runId: payload.runId });

  await emitter.emitStatus("running");
  log.info("codex agent started");

  try {
    // Build message content parts
    const contentParts: OpenAI.ChatCompletionContentPart[] = [];

    // Add images as image_url content parts
    if (payload.images && payload.images.length > 0) {
      for (const img of payload.images) {
        if (img.presignedUrl) {
          contentParts.push({
            type: "image_url",
            image_url: { url: img.presignedUrl },
          });
        }
      }
    }

    // Add user prompt text
    contentParts.push({ type: "text", text: payload.inputPrompt });

    // Stream the response
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 8192,
      stream: true,
      messages: [
        { role: "system", content: payload.resolvedPrompt },
        { role: "user", content: contentParts },
      ],
    });

    let fullResponse = "";
    let lastEmitted = 0;
    const CHUNK_SIZE = 200;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        if (fullResponse.length - lastEmitted >= CHUNK_SIZE) {
          const text = fullResponse.slice(lastEmitted);
          lastEmitted = fullResponse.length;
          await emitter.emitMessage("assistant", text);
        }
      }
    }

    // Emit remaining text
    if (fullResponse.length > lastEmitted) {
      await emitter.emitMessage("assistant", fullResponse.slice(lastEmitted));
    }

    // Extract and emit any code diffs
    const diffBlocks = extractDiffs(fullResponse);
    for (const diff of diffBlocks) {
      await emitter.emitDiff(diff);
    }

    await emitter.emitStatus("completed", "Agent run completed successfully");
    log.info("codex agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "codex agent failed");
  }
}

function extractDiffs(text: string): string[] {
  const diffs: string[] = [];
  const regex = /```diff\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) diffs.push(match[1].trim());
  }
  return diffs;
}
