// ---------------------------------------------------------------------------
// Comprehensive start command + port detection for Daytona sandboxes.
// Reads files from the sandbox filesystem to detect language, framework, and port.
// Mirrors the K8s detectStartConfig logic in sandbox.service.ts.
// ---------------------------------------------------------------------------

export type StartConfig = {
  installCommand: string | null;
  startCommand: string;
  port: number;
  portSource: string;
};

const NODE_SCRIPT_PRIORITY = [
  "dev", "start", "serve", "develop", "server",
  "start:dev", "start:prod", "preview", "watch",
];

async function readSandboxFile(sandbox: any, path: string): Promise<string | null> {
  try {
    const buf = await sandbox.fs.downloadFile(path);
    if (buf) return Buffer.from(buf).toString("utf-8");
  } catch {}
  return null;
}

async function fileExists(sandbox: any, path: string): Promise<boolean> {
  return (await readSandboxFile(sandbox, path)) !== null;
}

export async function detectStartAndPort(sandbox: any, repoDir: string): Promise<StartConfig> {
  const p = (file: string) => `${repoDir}/${file}`;

  // --- Node.js / Bun ---
  const pkgJsonRaw = await readSandboxFile(sandbox, p("package.json"));
  if (pkgJsonRaw) {
    try {
      const pkg = JSON.parse(pkgJsonRaw);
      const scripts: Record<string, string> = pkg.scripts ?? {};

      // Pick best start script
      let startScript: string | null = null;
      for (const name of NODE_SCRIPT_PRIORITY) {
        if (scripts[name]) { startScript = name; break; }
      }
      if (!startScript) {
        startScript = Object.keys(scripts).find(s => /start|dev|serve|run|watch|launch/i.test(s)) ?? null;
      }
      if (!startScript && Object.keys(scripts).length > 0) {
        startScript = Object.keys(scripts)[0] ?? null;
      }

      // Detect port from script command
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
        } else if (/nuxt/.test(cmd)) {
          port = 3000;
          portSource = `scripts.${startScript} (Nuxt)`;
        }
      }

      // Check .env files for PORT override (priority: .env > .env.local > .env.example > .env.sample)
      const envFileCandidates = [
        { file: p(".env"),              source: ".env" },
        { file: p(".env.local"),        source: ".env.local" },
        { file: p(".env.development"),  source: ".env.development" },
        { file: p(".env.example"),      source: ".env.example" },
        { file: p(".env.sample"),       source: ".env.sample" },
        { file: p(".env.template"),     source: ".env.template" },
      ];
      for (const { file, source } of envFileCandidates) {
        const envContent = await readSandboxFile(sandbox, file);
        if (!envContent) continue;
        const envMatch = envContent.match(/^PORT\s*=\s*["']?(\d{2,5})["']?/m);
        if (envMatch?.[1]) {
          port = parseInt(envMatch[1], 10);
          portSource = source;
          break;
        }
      }

      // Determine package manager
      const isBun = pkg.packageManager?.toString().startsWith("bun") || await fileExists(sandbox, p("bun.lockb")) || await fileExists(sandbox, p("bun.lock"));
      const isPnpm = pkg.packageManager?.toString().startsWith("pnpm") || await fileExists(sandbox, p("pnpm-lock.yaml"));
      const isYarn = await fileExists(sandbox, p("yarn.lock"));
      const runner = isBun ? "bun run" : isPnpm ? "pnpm run" : isYarn ? "yarn" : "npm run";
      const installer = isBun ? "bun install" : isPnpm ? "pnpm install" : isYarn ? "yarn install" : "npm ci || npm install";

      const startCmd = startScript
        ? `${runner} ${startScript}`
        : pkg.main ? `node ${pkg.main}` : "node .";

      return { installCommand: installer, startCommand: startCmd, port, portSource };
    } catch { /* fall through */ }
  }

  // Helper: check .env files for PORT override (same priority as Node.js section above)
  async function detectPortFromEnvFiles(): Promise<{ port: number; source: string } | null> {
    const envFiles = [
      { file: p(".env"),              source: ".env" },
      { file: p(".env.local"),        source: ".env.local" },
      { file: p(".env.development"),  source: ".env.development" },
      { file: p(".env.example"),      source: ".env.example" },
      { file: p(".env.sample"),       source: ".env.sample" },
      { file: p(".env.template"),     source: ".env.template" },
    ];
    for (const { file, source } of envFiles) {
      const content = await readSandboxFile(sandbox, file);
      if (!content) continue;
      const match = content.match(/^PORT\s*=\s*["']?(\d{2,5})["']?/m);
      if (match?.[1]) return { port: parseInt(match[1], 10), source };
    }
    return null;
  }

  // --- Ruby ---
  const gemfile = await readSandboxFile(sandbox, p("Gemfile"));
  if (gemfile) {
    const envPort = await detectPortFromEnvFiles();
    const isRails = gemfile.includes("rails");
    const hasPuma = gemfile.includes("puma");
    if (isRails) {
      const port = envPort?.port ?? 3000;
      return { installCommand: "bundle install", startCommand: `bundle exec rails s -b 0.0.0.0 -p ${port}`, port, portSource: envPort?.source ?? "Rails default" };
    }
    if (hasPuma) {
      const port = envPort?.port ?? 9292;
      return { installCommand: "bundle install", startCommand: `bundle exec puma -b tcp://0.0.0.0:${port}`, port, portSource: envPort?.source ?? "Puma default" };
    }
    const configRu = await readSandboxFile(sandbox, p("config.ru"));
    if (configRu) {
      const port = envPort?.port ?? 9292;
      return { installCommand: "bundle install", startCommand: `bundle exec rackup -o 0.0.0.0 -p ${port}`, port, portSource: envPort?.source ?? "Rack default" };
    }
    const port = envPort?.port ?? 4567;
    return { installCommand: "bundle install", startCommand: "bundle exec ruby app.rb || bundle exec ruby main.rb", port, portSource: envPort?.source ?? "Sinatra default" };
  }

  // --- Python ---
  const requirements = await readSandboxFile(sandbox, p("requirements.txt"));
  const pyproject = await readSandboxFile(sandbox, p("pyproject.toml"));
  if (requirements || pyproject) {
    const reqs = (requirements ?? "") + (pyproject ?? "");
    const lower = reqs.toLowerCase();
    const install = requirements ? "pip install -r requirements.txt" : "pip install .";
    const envPort = await detectPortFromEnvFiles();
    let port = 5000;
    let portSource = "Python default";
    if (lower.includes("django")) { port = 8000; portSource = "Django default"; }
    else if (lower.includes("fastapi")) { port = 8000; portSource = "FastAPI default"; }
    else if (lower.includes("flask")) { port = 5000; portSource = "Flask default"; }
    if (envPort) { port = envPort.port; portSource = envPort.source; }
    if (lower.includes("django")) {
      return { installCommand: install, startCommand: `python manage.py runserver 0.0.0.0:${port}`, port, portSource };
    }
    if (lower.includes("fastapi")) {
      return { installCommand: install, startCommand: `uvicorn main:app --host 0.0.0.0 --port ${port}`, port, portSource };
    }
    if (lower.includes("flask")) {
      return { installCommand: install, startCommand: `python -m flask run --host=0.0.0.0 --port=${port}`, port, portSource };
    }
    return { installCommand: install, startCommand: "python app.py || python main.py || python server.py", port, portSource };
  }

  // --- Go ---
  if (await fileExists(sandbox, p("go.mod"))) {
    const envPort = await detectPortFromEnvFiles();
    const port = envPort?.port ?? 8080;
    return { installCommand: null, startCommand: "go run .", port, portSource: envPort?.source ?? "Go default" };
  }

  // --- Rust ---
  if (await fileExists(sandbox, p("Cargo.toml"))) {
    const envPort = await detectPortFromEnvFiles();
    const port = envPort?.port ?? 8080;
    return { installCommand: null, startCommand: "cargo run --release", port, portSource: envPort?.source ?? "Rust default" };
  }

  // --- Java (Maven / Gradle) ---
  const pomXml = await readSandboxFile(sandbox, p("pom.xml"));
  if (pomXml) {
    const envPort = await detectPortFromEnvFiles();
    const isSpringBoot = pomXml.includes("spring-boot");
    const port = envPort?.port ?? 8080;
    const portSource = envPort?.source ?? (isSpringBoot ? "Spring Boot default" : "Java/Maven default");
    return {
      installCommand: null,
      startCommand: isSpringBoot
        ? `./mvnw spring-boot:run -Dserver.port=${port} || mvn spring-boot:run -Dserver.port=${port}`
        : "./mvnw package -DskipTests && java -jar target/*.jar || mvn package -DskipTests && java -jar target/*.jar",
      port,
      portSource,
    };
  }
  const buildGradle = await readSandboxFile(sandbox, p("build.gradle"))
    ?? await readSandboxFile(sandbox, p("build.gradle.kts"));
  if (buildGradle) {
    const envPort = await detectPortFromEnvFiles();
    const isSpringBoot = buildGradle.includes("spring-boot") || buildGradle.includes("org.springframework.boot");
    const port = envPort?.port ?? 8080;
    const portSource = envPort?.source ?? (isSpringBoot ? "Spring Boot default" : "Java/Gradle default");
    return {
      installCommand: null,
      startCommand: isSpringBoot
        ? `./gradlew bootRun --args='--server.port=${port}' || gradle bootRun --args='--server.port=${port}'`
        : "./gradlew run || gradle run",
      port,
      portSource,
    };
  }

  // --- PHP (Laravel / Symfony) ---
  const composerJson = await readSandboxFile(sandbox, p("composer.json"));
  if (composerJson) {
    const envPort = await detectPortFromEnvFiles();
    const isLaravel = composerJson.includes("laravel/framework");
    const isSymfony = composerJson.includes("symfony/framework-bundle");
    const port = envPort?.port ?? 8000;
    if (isLaravel) {
      return { installCommand: "composer install --no-interaction", startCommand: `php artisan serve --host=0.0.0.0 --port=${port}`, port, portSource: envPort?.source ?? "Laravel default" };
    }
    if (isSymfony) {
      return { installCommand: "composer install --no-interaction", startCommand: `php -S 0.0.0.0:${port} -t public/`, port, portSource: envPort?.source ?? "Symfony default" };
    }
    return { installCommand: "composer install --no-interaction", startCommand: `php -S 0.0.0.0:${port}`, port, portSource: envPort?.source ?? "PHP default" };
  }

  // --- Elixir ---
  const mixExs = await readSandboxFile(sandbox, p("mix.exs"));
  if (mixExs) {
    const envPort = await detectPortFromEnvFiles();
    const isPhoenix = mixExs.includes(":phoenix");
    const port = envPort?.port ?? 4000;
    return {
      installCommand: "mix deps.get",
      startCommand: isPhoenix ? "mix phx.server" : "mix run --no-halt",
      port,
      portSource: envPort?.source ?? (isPhoenix ? "Phoenix default" : "Elixir default"),
    };
  }

  // --- .NET ---
  if (await fileExists(sandbox, p("Program.cs")) || await fileExists(sandbox, p("*.csproj"))) {
    const envPort = await detectPortFromEnvFiles();
    const port = envPort?.port ?? 5000;
    return { installCommand: "dotnet restore", startCommand: `dotnet run --urls http://0.0.0.0:${port}`, port, portSource: envPort?.source ?? ".NET default" };
  }

  // --- Fallback: still check .env ---
  const fallbackEnvPort = await detectPortFromEnvFiles();
  if (fallbackEnvPort) {
    return { installCommand: null, startCommand: "sleep infinity", port: fallbackEnvPort.port, portSource: fallbackEnvPort.source };
  }
  return { installCommand: null, startCommand: "sleep infinity", port: 3000, portSource: "fallback" };
}
