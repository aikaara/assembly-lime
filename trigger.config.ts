import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalPackages } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_iygffcufsammqcnkaugq",
  runtime: "node",
  logLevel: "log",
  maxDuration: 14400,
  machine: "small-2x",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ["apps/trigger"],
  build: {
    external: ["pino", "pino-pretty"],
    extensions: [
      additionalPackages({
        packages: [
          "@anthropic-ai/claude-agent-sdk",
          "@anthropic-ai/sdk",
          "@aws-sdk/client-bedrock-runtime",
          "@daytonaio/sdk",
          "@kubernetes/client-node",
          "@sinclair/typebox",
          "ajv",
          "ajv-formats",
          "diff",
          "openai",
          "partial-json",
          "pino",
          "pino-pretty",
        ],
      }),
    ],
  },
});
