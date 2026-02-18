import pino from "pino";

let transport: pino.TransportSingleOptions | undefined;
if (process.env.NODE_ENV !== "production") {
  try {
    require.resolve("pino-pretty");
    transport = { target: "pino-pretty", options: { colorize: true } };
  } catch {
    // pino-pretty not resolvable (e.g. Trigger.dev worker) — use default JSON output
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
