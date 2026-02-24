import { Daytona, type Sandbox } from "@daytonaio/sdk";

export class DaytonaWorkspace {
  sandbox: Sandbox;
  repoDir: string;
  private authUser?: string;
  private authPass?: string;

  private constructor(sandbox: Sandbox, repoDir: string, authUser?: string, authPass?: string) {
    this.sandbox = sandbox;
    this.repoDir = repoDir;
    this.authUser = authUser;
    this.authPass = authPass;
  }

  /**
   * Create a Daytona sandbox without cloning any repo.
   * Use `cloneRepo()` afterwards to clone with auth credentials.
   */
  static async createSandbox(opts: {
    runId: number;
    provider: string;
    mode: string;
    repoName: string;
    volumeName?: string;
    envVars?: Record<string, string>;
  }): Promise<DaytonaWorkspace> {
    const daytona = new Daytona();
    const labels: Record<string, string> = {
      "assembly-lime/runId": String(opts.runId),
      "assembly-lime/provider": opts.provider,
      "assembly-lime/mode": opts.mode,
    };

    let volumes: Array<{ volumeId: string; mountPath: string }> | undefined;
    if (opts.volumeName) {
      try {
        const volume = await daytona.volume.get(opts.volumeName, true);
        volumes = [{ volumeId: volume.id, mountPath: "/data" }];
      } catch {
        // Volume support is optional — fall through if unavailable
      }
    }

    const sandbox = await daytona.create({
      public: false,
      labels,
      autoStopInterval: 60,
      ...(opts.envVars ? { envVars: opts.envVars } : {}),
      ...(volumes ? { volumes } : {}),
    });

    // Resolve absolute path within sandbox so tools don't use local CWD
    const workDir = await sandbox.getWorkDir() || "/home/daytona";
    const repoDir = `${workDir.replace(/\/+$/, "")}/${opts.repoName || "repo"}`;
    return new DaytonaWorkspace(sandbox, repoDir);
  }

  // ── Sandbox lifecycle ──────────────────────────────────────────────

  /** Stop sandbox to free CPU/memory (keeps disk). */
  async stop(): Promise<void> {
    await this.sandbox.stop();
  }

  /** Start a stopped sandbox. */
  async start(timeout?: number): Promise<void> {
    await this.sandbox.start(timeout);
  }

  /** Prevent auto-stop during active work. */
  async keepAlive(): Promise<void> {
    await this.sandbox.refreshActivity();
  }

  /** Delete sandbox permanently (frees all resources). */
  async delete(): Promise<void> {
    const daytona = new Daytona();
    await daytona.delete(this.sandbox);
  }

  /** Reconnect to an existing sandbox by ID. */
  static async reconnect(opts: {
    sandboxId: string;
    repoDir: string;
    authToken?: string;
  }): Promise<DaytonaWorkspace> {
    const daytona = new Daytona();
    const sandbox = await daytona.get(opts.sandboxId);

    // Start if stopped
    if ((sandbox as any).state === "stopped") {
      await sandbox.start();
    }

    const authUser = opts.authToken ? "x-access-token" : undefined;
    const authPass = opts.authToken || undefined;
    return new DaytonaWorkspace(sandbox, opts.repoDir, authUser, authPass);
  }

  /**
   * Clone a repo into the sandbox with auth credentials.
   */
  async cloneRepo(opts: {
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    authToken?: string;
  }): Promise<void> {
    const branch = opts.ref || opts.defaultBranch;
    const authUser = opts.authToken ? "x-access-token" : undefined;
    const authPass = opts.authToken || undefined;

    this.authUser = authUser;
    this.authPass = authPass;

    await this.sandbox.git.clone(
      opts.cloneUrl,
      this.repoDir,
      branch,
      undefined,
      authUser,
      authPass,
    );
  }

  /** Update stored auth credentials (e.g. after token refresh). */
  setAuthCredentials(user: string, pass: string): void {
    this.authUser = user;
    this.authPass = pass;
  }

  /**
   * Refresh a previously cloned repo: fetch, checkout, reset, clean.
   * Used when reusing a cached (stopped) sandbox.
   */
  async refreshRepo(opts: {
    defaultBranch: string;
    authToken?: string;
  }): Promise<void> {
    const branch = opts.defaultBranch;

    // Update auth credentials if provided
    if (opts.authToken) {
      this.authUser = "x-access-token";
      this.authPass = opts.authToken;
    }

    // Configure credential helper for fetch/push
    if (this.authUser && this.authPass) {
      await this.sandbox.process.executeCommand(
        `git config credential.helper '!f() { echo "username=${this.authUser}"; echo "password=${this.authPass}"; }; f'`,
        this.repoDir,
      );
    }

    await this.sandbox.process.executeCommand(
      `git fetch origin ${branch}`,
      this.repoDir,
    );
    await this.sandbox.process.executeCommand(
      `git checkout ${branch}`,
      this.repoDir,
    );
    await this.sandbox.process.executeCommand(
      `git reset --hard origin/${branch}`,
      this.repoDir,
    );
    await this.sandbox.process.executeCommand(
      `git clean -fdx`,
      this.repoDir,
    );
  }

  /**
   * Convenience: creates a Daytona sandbox, clones the repository, and returns a workspace instance.
   */
  static async create(opts: {
    runId: number;
    provider: string;
    mode: string;
    repo: {
      cloneUrl: string;
      name: string;
      defaultBranch: string;
      ref?: string;
      authToken?: string;
    };
  }): Promise<DaytonaWorkspace> {
    const workspace = await DaytonaWorkspace.createSandbox({
      runId: opts.runId,
      provider: opts.provider,
      mode: opts.mode,
      repoName: opts.repo.name,
    });

    await workspace.cloneRepo({
      cloneUrl: opts.repo.cloneUrl,
      defaultBranch: opts.repo.defaultBranch,
      ref: opts.repo.ref,
      authToken: opts.repo.authToken,
    });

    return workspace;
  }

  // ── Git operations ──────────────────────────────────────────────────

  async createBranch(name: string): Promise<void> {
    await this.sandbox.process.executeCommand(
      `git checkout -b ${name}`,
      this.repoDir,
    );
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.sandbox.process.executeCommand(
      `git rev-parse --abbrev-ref HEAD`,
      this.repoDir,
    );
    return result.result.trim();
  }

  async stageAll(): Promise<void> {
    await this.sandbox.process.executeCommand(
      `git add -A`,
      this.repoDir,
    );
  }

  /** Commit staged changes. Returns the commit SHA. */
  async commit(message: string, author: string, email: string): Promise<string> {
    const escapedMsg = message.replace(/"/g, '\\"');
    await this.sandbox.process.executeCommand(
      `git -c user.name="${author}" -c user.email="${email}" commit -m "${escapedMsg}"`,
      this.repoDir,
    );
    const result = await this.sandbox.process.executeCommand(
      `git rev-parse HEAD`,
      this.repoDir,
    );
    return result.result.trim();
  }

  async push(): Promise<void> {
    // Configure credential helper for authenticated push
    if (this.authUser && this.authPass) {
      await this.sandbox.process.executeCommand(
        `git -c credential.helper='!f() { echo "username=${this.authUser}"; echo "password=${this.authPass}"; }; f' push -u origin HEAD`,
        this.repoDir,
      );
    } else {
      await this.sandbox.process.executeCommand(
        `git push -u origin HEAD`,
        this.repoDir,
      );
    }
  }

  // ── File operations ─────────────────────────────────────────────────

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = `${this.repoDir}/${relativePath}`;
    // Ensure parent directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir) {
      await this.sandbox.process.executeCommand(`mkdir -p ${dir}`);
    }
    await this.sandbox.fs.uploadFile(Buffer.from(content, "utf-8"), fullPath);
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = `${this.repoDir}/${relativePath}`;
    await this.sandbox.process.executeCommand(`rm -f ${fullPath}`);
  }

  // ── Diff ────────────────────────────────────────────────────────────

  async getDiffUnified(base: string): Promise<string> {
    const result = await this.sandbox.process.executeCommand(
      `git diff ${base} HEAD`,
      this.repoDir,
    );
    return result.result;
  }

  async getDiffStats(base: string): Promise<string> {
    const result = await this.sandbox.process.executeCommand(
      `git diff --stat ${base} HEAD`,
      this.repoDir,
    );
    return result.result;
  }

  // ── Preview ─────────────────────────────────────────────────────────

  async getSignedPreviewUrl(port: number, ttlSeconds: number): Promise<string | null> {
    try {
      const signed = await this.sandbox.getSignedPreviewUrl(port, ttlSeconds);
      return signed.url;
    } catch {
      return null;
    }
  }

  // ── Env vars ────────────────────────────────────────────────────────

  /** Write decrypted env vars as a .env file in the repo dir. */
  async injectEnvVars(envVars: Record<string, string>): Promise<void> {
    const entries = Object.entries(envVars);
    if (entries.length === 0) return;
    const content = entries.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    await this.sandbox.fs.uploadFile(
      Buffer.from(content, "utf-8"),
      `${this.repoDir}/.env`,
    );
  }

  // ── Shell ───────────────────────────────────────────────────────────

  async exec(command: string, timeout?: number): Promise<{ stdout: string; exitCode: number }> {
    const result = await this.sandbox.process.executeCommand(command, undefined, undefined, timeout);
    return { stdout: result.result, exitCode: result.exitCode };
  }

  // ── Dev server ─────────────────────────────────────────────────────

  /**
   * Detect start command, install deps, start dev server in a background
   * session, and return a signed preview URL.
   */
  async startDevServer(sessionId: string, portOverride?: number): Promise<{
    previewUrl: string | null;
    port: number;
    portSource: string;
    startCommand: string;
  }> {
    const config = await this.detectStartConfig();

    // Port override takes highest priority
    const port = portOverride ?? config.port;
    const portSource = portOverride ? "explicit override" : config.portSource;

    // Install dependencies
    if (config.installCommand) {
      await this.exec(`cd ${this.repoDir} && ${config.installCommand}`, 600);
    }

    // Start dev server in background session
    await this.sandbox.process.createSession(sessionId);
    await this.sandbox.process.executeSessionCommand(
      sessionId,
      { command: `cd ${this.repoDir} && ${config.startCommand}`, runAsync: true },
      0,
    );

    // Poll for port to become available (up to 15 attempts, 1s each)
    let previewUrl: string | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const { stdout } = await this.exec(`ss -tln | grep :${port}`);
        if (stdout.includes(`:${port}`)) {
          previewUrl = await this.getSignedPreviewUrl(port, 3600);
          if (previewUrl) break;
        }
      } catch {
        // ss may not be available — fall back to simple wait
        if (attempt >= 2) {
          previewUrl = await this.getSignedPreviewUrl(port, 3600);
          if (previewUrl) break;
        }
      }
    }

    // Final attempt if loop didn't get a URL
    if (!previewUrl) {
      previewUrl = await this.getSignedPreviewUrl(port, 3600);
    }

    return {
      previewUrl,
      port,
      portSource,
      startCommand: config.startCommand,
    };
  }

  /** Read a file from the sandbox, returning null if it doesn't exist. */
  private async readFile(path: string): Promise<string | null> {
    try {
      const buf = await this.sandbox.fs.downloadFile(path);
      if (buf) return Buffer.from(buf).toString("utf-8");
    } catch {}
    return null;
  }

  /** Check if a file exists in the sandbox. */
  private async fileExists(path: string): Promise<boolean> {
    return (await this.readFile(path)) !== null;
  }

  /** Port-related env var names in priority order. */
  private static PORT_VAR_NAMES = [
    "PORT",
    "VITE_PORT",
    "APP_PORT",
    "SERVER_PORT",
    "NEXT_PUBLIC_PORT",
    "DEV_PORT",
  ];

  /**
   * Parse a port from a dotenv-style file content.
   * Checks multiple var names in priority order:
   * PORT, VITE_PORT, APP_PORT, SERVER_PORT, NEXT_PUBLIC_PORT, DEV_PORT.
   */
  private parsePortFromEnv(content: string): number | null {
    for (const varName of DaytonaWorkspace.PORT_VAR_NAMES) {
      const regex = new RegExp(`^${varName}\\s*=\\s*["']?(\\d{2,5})["']?`, "m");
      const match = content.match(regex);
      if (match?.[1]) return parseInt(match[1], 10);
    }
    return null;
  }

  /**
   * Read .env files in priority order and return the first PORT found.
   * Priority: .env (injected real values) > .env.local > .env.development >
   *           .env.example > .env.sample > .env.template
   */
  private async detectPortFromEnvFiles(): Promise<{ port: number; source: string } | null> {
    const envFiles = [
      { file: ".env",              source: ".env" },
      { file: ".env.local",        source: ".env.local" },
      { file: ".env.development",  source: ".env.development" },
      { file: ".env.example",      source: ".env.example" },
      { file: ".env.sample",       source: ".env.sample" },
      { file: ".env.template",     source: ".env.template" },
    ];

    for (const { file, source } of envFiles) {
      const content = await this.readFile(`${this.repoDir}/${file}`);
      if (!content) continue;
      const port = this.parsePortFromEnv(content);
      if (port) return { port, source };
    }
    return null;
  }

  /**
   * Parse EXPOSE directives from a Dockerfile to detect the port.
   * Returns the first numeric EXPOSE port found.
   */
  private async detectPortFromDockerfile(): Promise<{ port: number; source: string } | null> {
    const dockerfiles = ["Dockerfile", "dockerfile", "Dockerfile.dev"];
    for (const file of dockerfiles) {
      const content = await this.readFile(`${this.repoDir}/${file}`);
      if (!content) continue;
      // Match EXPOSE 8080 or EXPOSE 8080/tcp — take first numeric port
      const match = content.match(/^EXPOSE\s+(\d{2,5})/m);
      if (match?.[1]) {
        return { port: parseInt(match[1], 10), source: `${file} EXPOSE` };
      }
    }
    return null;
  }

  /** Detect install command, start command, and port from repo contents. */
  private async detectStartConfig(): Promise<{
    installCommand: string | null;
    startCommand: string;
    port: number;
    portSource: string;
  }> {
    const p = (file: string) => `${this.repoDir}/${file}`;

    // --- Node.js / Bun ---
    const pkgJsonRaw = await this.readFile(p("package.json"));
    if (pkgJsonRaw) {
      try {
        const pkg = JSON.parse(pkgJsonRaw);
        const scripts: Record<string, string> = pkg.scripts ?? {};

        const priorities = ["dev", "start", "serve", "develop", "server", "start:dev", "preview", "watch"];
        let startScript: string | null = null;
        for (const name of priorities) {
          if (scripts[name]) { startScript = name; break; }
        }
        if (!startScript) {
          startScript = Object.keys(scripts).find(s => /start|dev|serve|run|watch/i.test(s)) ?? null;
        }
        if (!startScript && Object.keys(scripts).length > 0) {
          startScript = Object.keys(scripts)[0] ?? null;
        }

        // Default port from script command
        let port = 3000;
        let portSource = "Node.js default";
        if (startScript && scripts[startScript]) {
          const cmd = scripts[startScript]!;
          const portMatch = cmd.match(/(?:PORT[=\s]+|--port\s+|-p\s+)(\d{3,5})/);
          if (portMatch?.[1]) {
            port = parseInt(portMatch[1], 10);
            portSource = `scripts.${startScript}`;
          } else if (/vite|astro/.test(cmd)) {
            port = 5173;
            portSource = `scripts.${startScript} (Vite)`;
          } else if (/next/.test(cmd)) {
            port = 3000;
            portSource = `scripts.${startScript} (Next.js)`;
          }
        }

        // Override: check Dockerfile EXPOSE (medium priority)
        const dockerPort = await this.detectPortFromDockerfile();
        if (dockerPort) {
          port = dockerPort.port;
          portSource = dockerPort.source;
        }

        // Override: check .env files for PORT (highest priority)
        const envPort = await this.detectPortFromEnvFiles();
        if (envPort) {
          port = envPort.port;
          portSource = envPort.source;
        }

        const isBun = pkg.packageManager?.toString().startsWith("bun")
          || await this.fileExists(p("bun.lockb"))
          || await this.fileExists(p("bun.lock"));
        const isPnpm = pkg.packageManager?.toString().startsWith("pnpm")
          || await this.fileExists(p("pnpm-lock.yaml"));
        const isYarn = await this.fileExists(p("yarn.lock"));
        const runner = isBun ? "bun run" : isPnpm ? "pnpm run" : isYarn ? "yarn" : "npm run";
        const installer = isBun ? "bun install" : isPnpm ? "pnpm install" : isYarn ? "yarn install" : "npm ci || npm install";

        const startCmd = startScript
          ? `${runner} ${startScript}`
          : pkg.main ? `node ${pkg.main}` : "node .";

        return { installCommand: installer, startCommand: startCmd, port, portSource };
      } catch { /* fall through */ }
    }

    // --- Python ---
    const requirements = await this.readFile(p("requirements.txt"));
    if (requirements) {
      const lower = requirements.toLowerCase();
      const install = "pip install -r requirements.txt";
      let port = 5000;
      let portSource = "Python default";
      if (lower.includes("django")) { port = 8000; portSource = "Django default"; }
      else if (lower.includes("fastapi")) { port = 8000; portSource = "FastAPI default"; }
      else if (lower.includes("flask")) { port = 5000; portSource = "Flask default"; }

      // Override: Dockerfile EXPOSE
      const dockerPort = await this.detectPortFromDockerfile();
      if (dockerPort) { port = dockerPort.port; portSource = dockerPort.source; }

      // Override from .env files
      const envPort = await this.detectPortFromEnvFiles();
      if (envPort) { port = envPort.port; portSource = envPort.source; }

      if (lower.includes("django")) return { installCommand: install, startCommand: `python manage.py runserver 0.0.0.0:${port}`, port, portSource };
      if (lower.includes("fastapi")) return { installCommand: install, startCommand: `uvicorn main:app --host 0.0.0.0 --port ${port}`, port, portSource };
      if (lower.includes("flask")) return { installCommand: install, startCommand: `python -m flask run --host=0.0.0.0 --port=${port}`, port, portSource };
      return { installCommand: install, startCommand: "python app.py || python main.py", port, portSource };
    }

    // --- Go ---
    if (await this.fileExists(p("go.mod"))) {
      let port = 8080;
      let portSource = "Go default";
      const goDockerPort = await this.detectPortFromDockerfile();
      if (goDockerPort) { port = goDockerPort.port; portSource = goDockerPort.source; }
      const goEnvPort = await this.detectPortFromEnvFiles();
      if (goEnvPort) { port = goEnvPort.port; portSource = goEnvPort.source; }
      return { installCommand: null, startCommand: "go run .", port, portSource };
    }

    // --- Rust ---
    if (await this.fileExists(p("Cargo.toml"))) {
      let port = 8080;
      let portSource = "Rust default";
      const rustDockerPort = await this.detectPortFromDockerfile();
      if (rustDockerPort) { port = rustDockerPort.port; portSource = rustDockerPort.source; }
      const rustEnvPort = await this.detectPortFromEnvFiles();
      if (rustEnvPort) { port = rustEnvPort.port; portSource = rustEnvPort.source; }
      return { installCommand: null, startCommand: "cargo run --release", port, portSource };
    }

    // --- Ruby ---
    const gemfile = await this.readFile(p("Gemfile"));
    if (gemfile) {
      let port = gemfile.includes("rails") ? 3000 : 4567;
      let portSource = gemfile.includes("rails") ? "Rails default" : "Sinatra default";
      const rubyDockerPort = await this.detectPortFromDockerfile();
      if (rubyDockerPort) { port = rubyDockerPort.port; portSource = rubyDockerPort.source; }
      const rubyEnvPort = await this.detectPortFromEnvFiles();
      if (rubyEnvPort) { port = rubyEnvPort.port; portSource = rubyEnvPort.source; }
      if (gemfile.includes("rails")) {
        return { installCommand: "bundle install", startCommand: `bundle exec rails s -b 0.0.0.0 -p ${port}`, port, portSource };
      }
      return { installCommand: "bundle install", startCommand: "bundle exec ruby app.rb", port, portSource };
    }

    // --- Fallback: check Dockerfile then .env ---
    const fallbackDockerPort = await this.detectPortFromDockerfile();
    if (fallbackDockerPort) {
      return { installCommand: null, startCommand: "sleep infinity", port: fallbackDockerPort.port, portSource: fallbackDockerPort.source };
    }
    const envPort = await this.detectPortFromEnvFiles();
    if (envPort) {
      return { installCommand: null, startCommand: "sleep infinity", port: envPort.port, portSource: envPort.source };
    }

    return { installCommand: null, startCommand: "sleep infinity", port: 3000, portSource: "fallback" };
  }
}

export function getDaytonaSandboxUrl(sandboxId: string): string {
  const apiUrl = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\/+$/, "");
  const baseUrl = apiUrl.endsWith("/api") ? apiUrl.slice(0, -4) : apiUrl;
  return `${baseUrl}/sandbox/${sandboxId}`;
}
