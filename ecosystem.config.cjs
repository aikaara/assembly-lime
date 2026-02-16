module.exports = {
  apps: [
    {
      name: "al-api",
      script: "dist/api/index.js",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "al-worker-claude",
      script: "dist/worker-claude/main.js",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1G",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "al-worker-codex",
      script: "dist/worker-codex/main.js",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1G",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
