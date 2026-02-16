const fs = require("fs");
const path = require("path");

// Parse .env file manually (no external deps — PM2 runs in Node)
function loadEnv() {
  const envPath = path.resolve(__dirname, ".env");
  const vars = {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  } catch {}
  return vars;
}

const dotEnv = loadEnv();
const nodeModules = path.resolve(__dirname, "node_modules");

module.exports = {
  apps: [
    {
      name: "al-api",
      script: "bun",
      args: "apps/api/src/index.ts",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      env: {
        ...dotEnv,
        NODE_ENV: "production",
        NODE_PATH: nodeModules,
        BUN_INSTALL_BIN: nodeModules + "/.bin",
      },
    },
    {
      name: "al-worker-claude",
      script: "bun",
      args: "dist/worker-claude/main.js",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1G",
      env: {
        ...dotEnv,
        NODE_ENV: "production",
        NODE_PATH: nodeModules,
        BUN_INSTALL_BIN: nodeModules + "/.bin",
      },
    },
    {
      name: "al-worker-codex",
      script: "bun",
      args: "dist/worker-codex/main.js",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1G",
      env: {
        ...dotEnv,
        NODE_ENV: "production",
        NODE_PATH: nodeModules,
        BUN_INSTALL_BIN: nodeModules + "/.bin",
      },
    },
  ],
};
