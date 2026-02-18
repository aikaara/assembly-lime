import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalPackages } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_iygffcufsammqcnkaugq",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  machine: "small-2x",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ["apps/trigger"],
  build: {
    extensions: [
      additionalPackages({
        packages: [
          "@anthropic-ai/claude-agent-sdk",
          "@daytonaio/sdk",
          "@kubernetes/client-node",
          "pino",
          "pino-pretty",
          "openai",
        ],
      }),
    ],
  },
});
