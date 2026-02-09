import Anthropic from "@anthropic-ai/sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { logger } from "../lib/logger";

const anthropic = new Anthropic();

export async function runClaudeAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
): Promise<void> {
  const log = logger.child({ runId: payload.runId });

  await emitter.emitStatus("running");
  log.info("claude agent started");

  try {
    // Build message content parts
    const contentParts: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    // Add images if present
    if (payload.images && payload.images.length > 0) {
      for (const img of payload.images) {
        if (img.presignedUrl) {
          // Fetch image and send as base64
          const response = await fetch(img.presignedUrl);
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const mediaType = img.mimeType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp";
          contentParts.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          });
        }
      }
    }

    // Add the user prompt text
    contentParts.push({ type: "text", text: payload.inputPrompt });

    // Stream the response
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: payload.resolvedPrompt,
      messages: [{ role: "user", content: contentParts }],
    });

    let fullResponse = "";

    stream.on("text", (text) => {
      fullResponse += text;
    });

    // Emit chunks periodically
    let lastEmitted = 0;
    const CHUNK_SIZE = 200;
    stream.on("text", async (text) => {
      fullResponse.length; // force evaluation
      if (fullResponse.length - lastEmitted >= CHUNK_SIZE) {
        const chunk = fullResponse.slice(lastEmitted);
        lastEmitted = fullResponse.length;
        await emitter.emitMessage("assistant", chunk);
      }
    });

    const finalMessage = await stream.finalMessage();

    // Emit any remaining text
    if (fullResponse.length > lastEmitted) {
      await emitter.emitMessage("assistant", fullResponse.slice(lastEmitted));
    }

    // Extract and emit any code diffs from the response
    const diffBlocks = extractDiffs(fullResponse);
    for (const diff of diffBlocks) {
      await emitter.emitDiff(diff);
    }

    // Emit usage info
    const usage = finalMessage.usage;
    await emitter.emitLog(
      `tokens: input=${usage.input_tokens} output=${usage.output_tokens}`
    );

    await emitter.emitStatus("completed", "Agent run completed successfully");
    log.info({ usage }, "claude agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "claude agent failed");
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
