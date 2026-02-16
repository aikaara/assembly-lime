import { eq, and } from "drizzle-orm";
import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { sandboxes, repositories, connectors, repositoryConfigs } from "@assembly-lime/shared/db/schema";
import { getClusterClient } from "./k8s-cluster.service";
import { tenantNamespace, ensureGitCredentialSecret } from "./namespace-provisioner.service";
import { decryptToken } from "../lib/encryption";
import { PREVIEW_DOMAIN, PREVIEW_INGRESS_CLASS } from "../lib/k8s";
import { childLogger } from "../lib/logger";
import { Daytona } from "@daytonaio/sdk";

const log = childLogger({ module: "sandbox-service" });

const GITHUB_API = "https://api.github.com";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 53);
}

/** Extract K8s API error body for logging. */
function k8sErrorBody(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as any).body;
    if (typeof body === "string") {
      try { return JSON.parse(body).message ?? body; } catch { return body; }
    }
    if (typeof body === "object" && body?.message) return body.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Port detection — reads repo config via GitHub API
// ---------------------------------------------------------------------------

async function githubFetchJson(token: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function githubFileContent(token: string, owner: string, repoName: string, filePath: string, ref?: string): Promise<string | null> {
  let apiPath = `/repos/${owner}/${repoName}/contents/${filePath}`;
  if (ref) apiPath += `?ref=${encodeURIComponent(ref)}`;
  const data = await githubFetchJson(token, apiPath);
  if (!data?.content) return null;
  return Buffer.from(data.content, "base64").toString("utf-8");
}

type SandboxConfig = {
  image: string;
  command: string;
  port: number;
  portSource: string;
  startScript: string | null;
  detectedFrom: string;
};

const SANDBOX_CONFIG_PATH = "_sandbox_config";

/** Load a previously saved sandbox config for this repo. */
async function loadCachedConfig(db: Db, tenantId: number, repositoryId: number): Promise<SandboxConfig | null> {
  const [row] = await db
    .select()
    .from(repositoryConfigs)
    .where(
      and(
        eq(repositoryConfigs.tenantId, tenantId),
        eq(repositoryConfigs.repositoryId, repositoryId),
        eq(repositoryConfigs.filePath, SANDBOX_CONFIG_PATH),
      )
    );
  if (!row) return null;
  try {
    const keys = row.detectedKeys as Record<string, unknown>;
    if (keys && typeof keys === "object" && "image" in keys && "command" in keys) {
      log.info({ repositoryId }, "using cached sandbox config");
      return keys as unknown as SandboxConfig;
    }
  } catch { /* invalid — re-detect */ }
  return null;
}

/** Save sandbox config for reuse on future creations. */
async function saveSandboxConfig(db: Db, tenantId: number, repositoryId: number, config: SandboxConfig): Promise<void> {
  await db
    .insert(repositoryConfigs)
    .values({
      tenantId,
      repositoryId,
      filePath: SANDBOX_CONFIG_PATH,
      fileType: "sandbox_config",
      detectedKeys: config as any,
      contentHash: null,
    })
    .onConflictDoUpdate({
      target: [repositoryConfigs.tenantId, repositoryConfigs.repositoryId, repositoryConfigs.filePath],
      set: {
        detectedKeys: config as any,
        lastScannedAt: new Date(),
      },
    });
  log.info({ repositoryId, startScript: config.startScript, port: config.port }, "sandbox config saved");
}

/** Priority order for Node.js start scripts. */
const NODE_SCRIPT_PRIORITY = ["start", "dev", "serve", "develop", "server", "start:dev", "start:prod", "preview"];

// All sandboxes use Ubuntu with mise for runtime installation.
// This handles any language/version (Ruby 2.5.3, Node 18, Python 3.8, etc.)
const SANDBOX_BASE_IMAGE = "ubuntu:22.04";

/** System deps needed for building native extensions across languages. */
const SYSTEM_SETUP = [
  "export DEBIAN_FRONTEND=noninteractive",
  "apt-get update -qq",
  "apt-get install -y -qq --no-install-recommends build-essential curl git libssl-dev zlib1g-dev libffi-dev libreadline-dev libyaml-dev libgdbm-dev libncurses5-dev libsqlite3-dev pkg-config unzip wget ca-certificates >/dev/null 2>&1",
].join(" && ");

/** Install mise (polyglot runtime manager — handles Ruby, Node, Python, Go, Java, etc.) */
const MISE_INSTALL = [
  'curl -fsSL https://mise.jdx.dev/install.sh | bash',
  'export PATH="$HOME/.local/bin:$PATH"',
].join(" && ");

/** Extra system packages needed for specific languages (installed via apt). */
function languageSystemDeps(languages: string[]): string | null {
  const pkgs: string[] = [];
  for (const lang of languages) {
    switch (lang) {
      case "php":
        pkgs.push("libxml2-dev", "libcurl4-openssl-dev", "libpng-dev", "libonig-dev", "libzip-dev");
        break;
      case "elixir":
      case "erlang":
        pkgs.push("autoconf", "libwxgtk3.0-gtk3-dev", "libgl1-mesa-dev", "libglu1-mesa-dev");
        break;
      case "dotnet":
        pkgs.push("libicu-dev");
        break;
      case "swift":
        pkgs.push("libcurl4-openssl-dev", "libxml2-dev", "libedit-dev");
        break;
    }
  }
  if (pkgs.length === 0) return null;
  const unique = [...new Set(pkgs)];
  return `apt-get install -y -qq --no-install-recommends ${unique.join(" ")} >/dev/null 2>&1`;
}

type DetectedRuntime = {
  language: string;
  version: string | null;
  versionSource: string;
};

/** Detect language and version from repo config files. */
async function detectLanguage(token: string, owner: string, repoName: string, branch: string): Promise<DetectedRuntime[]> {
  const runtimes: DetectedRuntime[] = [];

  // 1. .tool-versions (mise/asdf — most authoritative, may specify multiple runtimes)
  const toolVersions = await githubFileContent(token, owner, repoName, ".tool-versions", branch);
  if (toolVersions) {
    for (const line of toolVersions.split("\n")) {
      const match = line.match(/^(\S+)\s+(\S+)/);
      if (match?.[1] && match?.[2]) {
        runtimes.push({ language: match[1], version: match[2], versionSource: ".tool-versions" });
      }
    }
    if (runtimes.length > 0) return runtimes;
  }

  // 2. Language-specific version files
  const rubyVersion = await githubFileContent(token, owner, repoName, ".ruby-version", branch);
  if (rubyVersion) {
    runtimes.push({ language: "ruby", version: rubyVersion.trim(), versionSource: ".ruby-version" });
  }
  const nodeVersion = await githubFileContent(token, owner, repoName, ".node-version", branch)
    ?? await githubFileContent(token, owner, repoName, ".nvmrc", branch);
  if (nodeVersion) {
    runtimes.push({ language: "node", version: nodeVersion.trim().replace(/^v/, ""), versionSource: ".node-version" });
  }
  const pythonVersion = await githubFileContent(token, owner, repoName, ".python-version", branch);
  if (pythonVersion) {
    runtimes.push({ language: "python", version: pythonVersion.trim(), versionSource: ".python-version" });
  }
  if (runtimes.length > 0) return runtimes;

  // 3. Detect from project files
  const gemfile = await githubFileContent(token, owner, repoName, "Gemfile", branch);
  if (gemfile) {
    const rubyMatch = gemfile.match(/ruby\s+["']([^"']+)["']/);
    runtimes.push({ language: "ruby", version: rubyMatch?.[1] ?? null, versionSource: rubyMatch ? "Gemfile" : "Gemfile (no version)" });
  }

  const pkgJson = await githubFileContent(token, owner, repoName, "package.json", branch);
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson);
      const engineNode = pkg.engines?.node;
      // Extract a concrete version from engine constraint (e.g. ">=18" → "18", "20.x" → "20")
      const verMatch = engineNode?.match(/(\d+)/);
      runtimes.push({ language: "node", version: verMatch?.[1] ?? null, versionSource: engineNode ? "package.json engines" : "package.json" });
    } catch {
      runtimes.push({ language: "node", version: null, versionSource: "package.json" });
    }
  }

  const reqs = await githubFileContent(token, owner, repoName, "requirements.txt", branch);
  if (reqs) {
    runtimes.push({ language: "python", version: null, versionSource: "requirements.txt" });
  }

  const gomod = await githubFileContent(token, owner, repoName, "go.mod", branch);
  if (gomod) {
    const goVerMatch = gomod.match(/^go\s+(\S+)/m);
    runtimes.push({ language: "go", version: goVerMatch?.[1] ?? null, versionSource: "go.mod" });
  }

  const cargoToml = await githubFileContent(token, owner, repoName, "Cargo.toml", branch);
  if (cargoToml) {
    runtimes.push({ language: "rust", version: null, versionSource: "Cargo.toml" });
  }

  // Java — pom.xml (Maven), build.gradle / build.gradle.kts (Gradle)
  const pomXml = await githubFileContent(token, owner, repoName, "pom.xml", branch);
  if (pomXml) {
    const javaVerMatch = pomXml.match(/<java\.version>(\d+)<\/java\.version>/)
      ?? pomXml.match(/<maven\.compiler\.source>(\d+)</)
      ?? pomXml.match(/<release>(\d+)<\/release>/);
    runtimes.push({ language: "java", version: javaVerMatch?.[1] ?? null, versionSource: "pom.xml" });
  }
  if (runtimes.length === 0) {
    const buildGradle = await githubFileContent(token, owner, repoName, "build.gradle", branch)
      ?? await githubFileContent(token, owner, repoName, "build.gradle.kts", branch);
    if (buildGradle) {
      const gradleJavaMatch = buildGradle.match(/(?:sourceCompatibility|targetCompatibility|JavaVersion\.VERSION_)(\d+)/);
      runtimes.push({ language: "java", version: gradleJavaMatch?.[1] ?? null, versionSource: "build.gradle" });
    }
  }

  // PHP — composer.json
  const composerJson = await githubFileContent(token, owner, repoName, "composer.json", branch);
  if (composerJson) {
    try {
      const composer = JSON.parse(composerJson);
      const phpVer = composer.require?.php;
      const verMatch = phpVer?.match(/(\d+\.\d+)/);
      runtimes.push({ language: "php", version: verMatch?.[1] ?? null, versionSource: phpVer ? "composer.json require.php" : "composer.json" });
    } catch {
      runtimes.push({ language: "php", version: null, versionSource: "composer.json" });
    }
  }

  // Elixir — mix.exs
  const mixExs = await githubFileContent(token, owner, repoName, "mix.exs", branch);
  if (mixExs) {
    const elixirVerMatch = mixExs.match(/elixir:\s*"~>\s*(\d+\.\d+)/);
    runtimes.push({ language: "elixir", version: elixirVerMatch?.[1] ?? null, versionSource: "mix.exs" });
    // Elixir requires Erlang
    const erlangVerMatch = mixExs.match(/erlang:\s*"~>\s*(\d+)/);
    runtimes.push({ language: "erlang", version: erlangVerMatch?.[1] ?? null, versionSource: "mix.exs (implied)" });
  }

  // .NET — *.csproj
  if (runtimes.length === 0) {
    const csproj = await githubFetchJson(token, `/repos/${owner}/${repoName}/contents?ref=${encodeURIComponent(branch)}`);
    const csprojFile = Array.isArray(csproj) ? csproj.find((f: any) => /\.csproj$/i.test(f.name)) : null;
    if (csprojFile) {
      const csprojContent = await githubFileContent(token, owner, repoName, csprojFile.name, branch);
      const tfmMatch = csprojContent?.match(/<TargetFramework>net(\d+\.\d+)/) ?? csprojContent?.match(/<TargetFramework>net(\d+)/);
      runtimes.push({ language: "dotnet", version: tfmMatch?.[1] ?? null, versionSource: csprojFile.name });
    }
  }

  // Scala — build.sbt
  if (runtimes.length === 0) {
    const buildSbt = await githubFileContent(token, owner, repoName, "build.sbt", branch);
    if (buildSbt) {
      const scalaVerMatch = buildSbt.match(/scalaVersion\s*:=\s*"(\d+\.\d+\.\d+)"/);
      runtimes.push({ language: "scala", version: scalaVerMatch?.[1] ?? null, versionSource: "build.sbt" });
      // Scala also needs Java
      runtimes.push({ language: "java", version: null, versionSource: "build.sbt (implied)" });
    }
  }

  // Kotlin — build.gradle.kts with kotlin plugin
  // (Already covered under Java — Kotlin projects use Gradle)

  // Swift — Package.swift
  if (runtimes.length === 0) {
    const packageSwift = await githubFileContent(token, owner, repoName, "Package.swift", branch);
    if (packageSwift) {
      const swiftVerMatch = packageSwift.match(/swift-tools-version:\s*(\d+\.\d+)/);
      runtimes.push({ language: "swift", version: swiftVerMatch?.[1] ?? null, versionSource: "Package.swift" });
    }
  }

  // Zig — build.zig
  if (runtimes.length === 0) {
    const buildZig = await githubFileContent(token, owner, repoName, "build.zig", branch);
    if (buildZig) {
      runtimes.push({ language: "zig", version: null, versionSource: "build.zig" });
    }
  }

  // Dart/Flutter — pubspec.yaml
  if (runtimes.length === 0) {
    const pubspec = await githubFileContent(token, owner, repoName, "pubspec.yaml", branch);
    if (pubspec) {
      const dartSdkMatch = pubspec.match(/sdk:\s*["']?>=?(\d+\.\d+)/);
      const isFlutter = pubspec.includes("flutter:");
      runtimes.push({ language: isFlutter ? "flutter" : "dart", version: dartSdkMatch?.[1] ?? null, versionSource: "pubspec.yaml" });
    }
  }

  // Fallback: scan the root directory listing to infer from file extensions
  if (runtimes.length === 0) {
    const rootContents = await githubFetchJson(token, `/repos/${owner}/${repoName}/contents?ref=${encodeURIComponent(branch)}`);
    if (Array.isArray(rootContents)) {
      const fileNames = rootContents.map((f: any) => f.name as string);
      // Check for common entry-point patterns
      if (fileNames.some((f) => /\.java$/i.test(f)) || fileNames.includes("src")) {
        runtimes.push({ language: "java", version: null, versionSource: "directory scan (.java)" });
      } else if (fileNames.some((f) => /\.php$/i.test(f))) {
        runtimes.push({ language: "php", version: null, versionSource: "directory scan (.php)" });
      } else if (fileNames.some((f) => /\.cs$/i.test(f) || /\.sln$/i.test(f))) {
        runtimes.push({ language: "dotnet", version: null, versionSource: "directory scan (.cs/.sln)" });
      } else if (fileNames.some((f) => /\.ex$/i.test(f) || /\.exs$/i.test(f))) {
        runtimes.push({ language: "elixir", version: null, versionSource: "directory scan (.ex)" });
      } else if (fileNames.some((f) => /\.scala$/i.test(f) || /\.sc$/i.test(f))) {
        runtimes.push({ language: "scala", version: null, versionSource: "directory scan (.scala)" });
      } else if (fileNames.some((f) => /\.swift$/i.test(f))) {
        runtimes.push({ language: "swift", version: null, versionSource: "directory scan (.swift)" });
      } else if (fileNames.some((f) => /\.zig$/i.test(f))) {
        runtimes.push({ language: "zig", version: null, versionSource: "directory scan (.zig)" });
      } else if (fileNames.some((f) => /\.dart$/i.test(f))) {
        runtimes.push({ language: "dart", version: null, versionSource: "directory scan (.dart)" });
      } else if (fileNames.some((f) => /\.rb$/i.test(f))) {
        runtimes.push({ language: "ruby", version: null, versionSource: "directory scan (.rb)" });
      } else if (fileNames.some((f) => /\.py$/i.test(f))) {
        runtimes.push({ language: "python", version: null, versionSource: "directory scan (.py)" });
      } else if (fileNames.some((f) => /\.go$/i.test(f))) {
        runtimes.push({ language: "go", version: null, versionSource: "directory scan (.go)" });
      } else if (fileNames.some((f) => /\.rs$/i.test(f))) {
        runtimes.push({ language: "rust", version: null, versionSource: "directory scan (.rs)" });
      } else if (fileNames.some((f) => /\.(js|ts|jsx|tsx)$/i.test(f))) {
        runtimes.push({ language: "node", version: null, versionSource: "directory scan (.js/.ts)" });
      }
    }
  }

  if (runtimes.length === 0) {
    runtimes.push({ language: "node", version: null, versionSource: "fallback" });
  }

  return runtimes;
}

/** Map our language keys to mise plugin names where they differ. */
const MISE_PLUGIN_MAP: Record<string, string> = {
  dotnet: "dotnet-core",
  flutter: "flutter",
  node: "node",
  // Most languages use their name directly in mise
};

/** Build mise install commands for the detected runtimes. */
function buildMiseInstalls(runtimes: DetectedRuntime[]): string {
  return runtimes
    .map((r) => {
      const plugin = MISE_PLUGIN_MAP[r.language] ?? r.language;
      const ver = r.version ? `@${r.version}` : "";
      return `mise use -g ${plugin}${ver}`;
    })
    .join(" && ");
}

/**
 * Read .env files from GitHub in priority order and return PORT if found.
 * Note: .env is usually gitignored, so we check .env.example, .env.sample, etc.
 * Priority: .env > .env.local > .env.development > .env.example > .env.sample > .env.template
 */
async function detectPortFromGitHub(
  token: string, owner: string, repoName: string, branch: string,
): Promise<{ port: number; source: string } | null> {
  const envFiles = [
    { file: ".env",              source: ".env" },
    { file: ".env.local",        source: ".env.local" },
    { file: ".env.development",  source: ".env.development" },
    { file: ".env.example",      source: ".env.example" },
    { file: ".env.sample",       source: ".env.sample" },
    { file: ".env.template",     source: ".env.template" },
  ];
  for (const { file, source } of envFiles) {
    const content = await githubFileContent(token, owner, repoName, file, branch);
    if (!content) continue;
    const match = content.match(/^PORT\s*=\s*["']?(\d{2,5})["']?/m);
    if (match?.[1]) return { port: parseInt(match[1], 10), source };
  }
  return null;
}

/** Detect start command and port for the primary language. */
async function detectStartConfig(
  token: string, owner: string, repoName: string, branch: string, primaryLang: string
): Promise<{ startCommand: string; port: number; portSource: string; startScript: string | null }> {

  // Read .env files from GitHub for PORT override (applies to all languages)
  const envPort = await detectPortFromGitHub(token, owner, repoName, branch);

  if (primaryLang === "node") {
    const pkgJson = await githubFileContent(token, owner, repoName, "package.json", branch);
    if (pkgJson) {
      try {
        const pkg = JSON.parse(pkgJson);
        const scripts = pkg.scripts ?? {};
        const availableScripts = Object.keys(scripts);

        let startScript: string | null = null;
        for (const name of NODE_SCRIPT_PRIORITY) {
          if (scripts[name]) { startScript = name; break; }
        }
        if (!startScript) {
          startScript = availableScripts.find((s) => /start|dev|serve|run|watch|launch/i.test(s)) ?? null;
        }
        if (!startScript && availableScripts.length > 0) {
          startScript = availableScripts[0] ?? null;
        }

        let port = 3000;
        let portSource = "Node.js default";
        if (startScript && scripts[startScript]) {
          const portMatch = (scripts[startScript] as string).match(/(?:PORT[=\s]+|--port\s+|-p\s+)(\d{3,5})/);
          if (portMatch?.[1]) { port = parseInt(portMatch[1], 10); portSource = `scripts.${startScript}`; }
        }

        // Override: .env files have highest priority
        if (envPort) { port = envPort.port; portSource = envPort.source; }

        const cmd = startScript ? `npm run ${startScript}` : pkg.main ? `node ${pkg.main}` : "node .";
        return { startCommand: `npm install && ${cmd}`, port, portSource, startScript };
      } catch { /* fall through */ }
    }
    const port = envPort?.port ?? 3000;
    return { startCommand: "npm install && npm start", port, portSource: envPort?.source ?? "Node.js default", startScript: "start" };
  }

  if (primaryLang === "ruby") {
    const gemfile = await githubFileContent(token, owner, repoName, "Gemfile", branch);
    const isRails = gemfile?.includes("rails") ?? false;
    const hasPuma = gemfile?.includes("puma") ?? false;
    if (isRails) {
      const port = envPort?.port ?? 3000;
      return {
        startCommand: `bundle install && bundle exec rails s -b 0.0.0.0 -p ${port}`,
        port, portSource: envPort?.source ?? "Rails default", startScript: "rails server",
      };
    }
    if (hasPuma) {
      const port = envPort?.port ?? 9292;
      return {
        startCommand: `bundle install && bundle exec puma -b tcp://0.0.0.0:${port}`,
        port, portSource: envPort?.source ?? "Puma default", startScript: "puma",
      };
    }
    const configRu = await githubFileContent(token, owner, repoName, "config.ru", branch);
    if (configRu) {
      const port = envPort?.port ?? 9292;
      return {
        startCommand: `bundle install && bundle exec rackup -o 0.0.0.0 -p ${port}`,
        port, portSource: envPort?.source ?? "Rack default", startScript: "rackup",
      };
    }
    const port = envPort?.port ?? 4567;
    return {
      startCommand: "bundle install && bundle exec ruby app.rb || bundle exec ruby main.rb",
      port, portSource: envPort?.source ?? "Sinatra default", startScript: null,
    };
  }

  if (primaryLang === "python") {
    const reqs = await githubFileContent(token, owner, repoName, "requirements.txt", branch);
    const isDjango = reqs?.toLowerCase().includes("django") ?? false;
    const isFlask = reqs?.toLowerCase().includes("flask") ?? false;
    const isFastapi = reqs?.toLowerCase().includes("fastapi") ?? false;
    if (isDjango) {
      const port = envPort?.port ?? 8000;
      return {
        startCommand: `pip install -r requirements.txt && python manage.py runserver 0.0.0.0:${port}`,
        port, portSource: envPort?.source ?? "Django default", startScript: "manage.py runserver",
      };
    }
    if (isFastapi) {
      const port = envPort?.port ?? 8000;
      return {
        startCommand: `pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port ${port}`,
        port, portSource: envPort?.source ?? "FastAPI default", startScript: "uvicorn",
      };
    }
    if (isFlask) {
      const port = envPort?.port ?? 5000;
      return {
        startCommand: `pip install -r requirements.txt && python -m flask run --host=0.0.0.0 --port=${port}`,
        port, portSource: envPort?.source ?? "Flask default", startScript: "flask run",
      };
    }
    const port = envPort?.port ?? 5000;
    return {
      startCommand: "pip install -r requirements.txt && python app.py || python main.py || python server.py",
      port, portSource: envPort?.source ?? "Python default", startScript: null,
    };
  }

  if (primaryLang === "go") {
    const port = envPort?.port ?? 8080;
    return { startCommand: "go run .", port, portSource: envPort?.source ?? "Go default", startScript: null };
  }

  if (primaryLang === "rust") {
    const port = envPort?.port ?? 8080;
    return { startCommand: "cargo run --release", port, portSource: envPort?.source ?? "Rust default", startScript: null };
  }

  if (primaryLang === "java") {
    const pomXml = await githubFileContent(token, owner, repoName, "pom.xml", branch);
    if (pomXml) {
      const isSpringBoot = pomXml.includes("spring-boot");
      const port = envPort?.port ?? 8080;
      return {
        startCommand: isSpringBoot
          ? `./mvnw spring-boot:run -Dserver.port=${port} || mvn spring-boot:run -Dserver.port=${port}`
          : "./mvnw package -DskipTests && java -jar target/*.jar || mvn package -DskipTests && java -jar target/*.jar",
        port,
        portSource: envPort?.source ?? (isSpringBoot ? "Spring Boot default" : "Java default"),
        startScript: isSpringBoot ? "spring-boot:run" : "mvn package",
      };
    }
    const buildGradle = await githubFileContent(token, owner, repoName, "build.gradle", branch)
      ?? await githubFileContent(token, owner, repoName, "build.gradle.kts", branch);
    if (buildGradle) {
      const isSpringBoot = buildGradle.includes("spring-boot") || buildGradle.includes("org.springframework.boot");
      const port = envPort?.port ?? 8080;
      return {
        startCommand: isSpringBoot
          ? `./gradlew bootRun --args='--server.port=${port}' || gradle bootRun --args='--server.port=${port}'`
          : "./gradlew run || gradle run",
        port,
        portSource: envPort?.source ?? (isSpringBoot ? "Spring Boot default" : "Java default"),
        startScript: isSpringBoot ? "bootRun" : "gradle run",
      };
    }
    const port = envPort?.port ?? 8080;
    return { startCommand: "javac *.java && java Main", port, portSource: envPort?.source ?? "Java default", startScript: null };
  }

  if (primaryLang === "php") {
    const composerJson = await githubFileContent(token, owner, repoName, "composer.json", branch);
    const isLaravel = composerJson?.includes("laravel/framework") ?? false;
    const isSymfony = composerJson?.includes("symfony/framework-bundle") ?? false;
    const port = envPort?.port ?? 8000;
    if (isLaravel) {
      return {
        startCommand: `composer install --no-interaction && php artisan serve --host=0.0.0.0 --port=${port}`,
        port, portSource: envPort?.source ?? "Laravel default", startScript: "artisan serve",
      };
    }
    if (isSymfony) {
      return {
        startCommand: `composer install --no-interaction && php -S 0.0.0.0:${port} -t public/`,
        port, portSource: envPort?.source ?? "Symfony default", startScript: "php built-in server",
      };
    }
    return {
      startCommand: `composer install --no-interaction 2>/dev/null; php -S 0.0.0.0:${port}`,
      port, portSource: envPort?.source ?? "PHP default", startScript: "php built-in server",
    };
  }

  if (primaryLang === "elixir") {
    const mixExs = await githubFileContent(token, owner, repoName, "mix.exs", branch);
    const isPhoenix = mixExs?.includes(":phoenix") ?? false;
    const port = envPort?.port ?? 4000;
    if (isPhoenix) {
      return {
        startCommand: "mix deps.get && mix phx.server",
        port, portSource: envPort?.source ?? "Phoenix default", startScript: "phx.server",
      };
    }
    return {
      startCommand: "mix deps.get && mix run --no-halt",
      port, portSource: envPort?.source ?? "Elixir default", startScript: "mix run",
    };
  }

  if (primaryLang === "dotnet") {
    const port = envPort?.port ?? 5000;
    return {
      startCommand: `dotnet restore && dotnet run --urls http://0.0.0.0:${port}`,
      port, portSource: envPort?.source ?? ".NET default", startScript: "dotnet run",
    };
  }

  if (primaryLang === "scala") {
    const buildSbt = await githubFileContent(token, owner, repoName, "build.sbt", branch);
    const isPlayFramework = buildSbt?.includes("PlayScala") ?? false;
    if (isPlayFramework) {
      const port = envPort?.port ?? 9000;
      return {
        startCommand: "sbt run",
        port, portSource: envPort?.source ?? "Play Framework default", startScript: "sbt run",
      };
    }
    const port = envPort?.port ?? 8080;
    return {
      startCommand: "sbt run",
      port, portSource: envPort?.source ?? "Scala default", startScript: "sbt run",
    };
  }

  if (primaryLang === "swift") {
    const port = envPort?.port ?? 8080;
    return {
      startCommand: "swift build && swift run",
      port, portSource: envPort?.source ?? "Swift default", startScript: "swift run",
    };
  }

  if (primaryLang === "zig") {
    const port = envPort?.port ?? 8080;
    return {
      startCommand: "zig build run",
      port, portSource: envPort?.source ?? "Zig default", startScript: "zig build run",
    };
  }

  if (primaryLang === "dart" || primaryLang === "flutter") {
    const port = envPort?.port ?? 8080;
    return {
      startCommand: "dart pub get && dart run",
      port, portSource: envPort?.source ?? "Dart default", startScript: "dart run",
    };
  }

  // Universal fallback
  const port = envPort?.port ?? 3000;
  return { startCommand: "sleep infinity", port, portSource: envPort?.source ?? "fallback", startScript: null };
}

/**
 * Detect full sandbox config: Ubuntu base image, mise runtime install, start command, port.
 * Works for any language — Ruby 2.5.3, Node 18, Python 3.8, Go, Rust, etc.
 */
async function detectSandboxConfig(token: string, owner: string, repoName: string, branch: string): Promise<SandboxConfig> {
  // 1. Detect language(s) and version(s)
  const runtimes = await detectLanguage(token, owner, repoName, branch);
  const primary: DetectedRuntime = runtimes[0] ?? { language: "node", version: null, versionSource: "fallback" };
  log.info({ runtimes }, "detected runtimes");

  // 2. Detect start command and port for the primary language
  // (detectStartConfig already checks .env files from GitHub for PORT override)
  const startConfig = await detectStartConfig(token, owner, repoName, branch, primary.language);
  const { port, portSource } = startConfig;

  // 3. Build the full command: system setup → language-specific deps → mise install → start
  const miseInstalls = buildMiseInstalls(runtimes);
  const languages = runtimes.map((r) => r.language);
  const extraDeps = languageSystemDeps(languages);
  const steps = [SYSTEM_SETUP];
  if (extraDeps) steps.push(extraDeps);
  steps.push(MISE_INSTALL, miseInstalls, 'eval "$(mise activate bash)"', `cd /workspace && ${startConfig.startCommand}`);
  const command = steps.join(" && ");

  log.info({
    primary: primary.language,
    version: primary.version,
    versionSource: primary.versionSource,
    startScript: startConfig.startScript,
    port,
  }, "sandbox config detected");

  return {
    image: SANDBOX_BASE_IMAGE,
    command,
    port,
    portSource,
    startScript: startConfig.startScript,
    detectedFrom: `${primary.language}${primary.version ? `@${primary.version}` : ""} (${primary.versionSource})`,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type CreateSandboxInput = {
  repositoryId: number;
  branch: string;
  clusterId: number;
  tenantSlug: string;
  envVarSetId?: number;
  createdBy?: number;
};
// K8s implementation (internal)
async function k8sCreateSandbox(db: Db, tenantId: number, input: CreateSandboxInput) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, input.repositoryId), eq(repositories.tenantId, tenantId)));
  if (!repo) throw new Error("Repository not found");

  // Get connector token for GitHub API reads + git clone auth
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, repo.connectorId), eq(connectors.tenantId, tenantId)));
  if (!connector) throw new Error("Connector not found for repository");

  const gitToken = decryptToken(connector.accessTokenEnc);

  // Check for cached sandbox config, otherwise detect from repo
  let config = await loadCachedConfig(db, tenantId, input.repositoryId);
  if (!config) {
    log.info({ repo: repo.fullName, branch: input.branch }, "detecting sandbox config from repo");
    config = await detectSandboxConfig(gitToken, repo.owner, repo.name, input.branch);
    await saveSandboxConfig(db, tenantId, input.repositoryId, config);
  }
  const containerPort = config.port;
  log.info({ port: containerPort, source: config.portSource, image: config.image, command: config.command, startScript: config.startScript }, "sandbox config resolved");

  const name = slugify(`sandbox-${repo.name}-${input.branch}`);
  const ns = tenantNamespace(input.tenantSlug);
  const host = `${name}.${PREVIEW_DOMAIN}`;

  // Get the K8s client for the registered cluster (includes Bun TLS fix)
  const kc = await getClusterClient(db, tenantId, input.clusterId);
  const core = kc.makeApiClient(k8s.CoreV1Api);
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

  // Ensure git credential secret for authenticated clone
  const gitSecretName = `git-cred-${connector.id}`;
  await ensureGitCredentialSecret(kc, ns, gitSecretName, gitToken);

  // Clean up any existing resources with the same name (idempotent re-create)
  try {
    await networkingApi.deleteNamespacedIngress({ namespace: ns, name });
  } catch { /* doesn't exist — fine */ }
  try {
    await core.deleteNamespacedService({ namespace: ns, name });
  } catch { /* doesn't exist — fine */ }
  try {
    await core.deleteNamespacedPod({ namespace: ns, name });
    // Wait briefly for pod termination
    await new Promise((r) => setTimeout(r, 2000));
  } catch { /* doesn't exist — fine */ }

  // 1. Create Pod with init-container (git clone) + main container (detected runtime)
  const pod: k8s.V1Pod = {
    metadata: {
      name,
      namespace: ns,
      labels: {
        "app.kubernetes.io/part-of": "assembly-lime",
        "assembly-lime/sandbox": name,
      },
    },
    spec: {
      serviceAccountName: "al-agent-sa",
      initContainers: [
        {
          name: "git-clone",
          image: "alpine/git:latest",
          command: [
            "sh",
            "-c",
            [
              "TOKEN=$(cat /etc/git-credentials/token)",
              `git clone --branch ${input.branch} --depth 1 https://x-access-token:\${TOKEN}@github.com/${repo.owner}/${repo.name}.git /workspace`,
            ].join(" && "),
          ],
          volumeMounts: [
            { name: "workspace", mountPath: "/workspace" },
            { name: "git-credentials", mountPath: "/etc/git-credentials", readOnly: true },
          ],
          env: [{ name: "GIT_TERMINAL_PROMPT", value: "0" }],
        },
      ],
      containers: [
        {
          name: "sandbox",
          image: config.image,
          command: ["sh", "-c", config.command],
          ports: [{ containerPort }],
          env: [{ name: "PORT", value: String(containerPort) }],
          volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
          resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "500m", memory: "512Mi" },
          },
        },
      ],
      volumes: [
        { name: "workspace", emptyDir: {} },
        {
          name: "git-credentials",
          secret: {
            secretName: gitSecretName,
            defaultMode: 0o400,
          },
        },
      ],
      restartPolicy: "Never",
    },
  };

  try {
    await core.createNamespacedPod({ namespace: ns, body: pod });
    log.info({ name, namespace: ns }, "sandbox pod created");
  } catch (err) {
    const msg = k8sErrorBody(err);
    log.error({ err: msg, name, namespace: ns }, "failed to create sandbox pod");
    throw new Error(`Pod creation failed: ${msg}`);
  }

  // 2. Create Service (ClusterIP) pointing to the pod
  const svcName = name;
  const service: k8s.V1Service = {
    metadata: {
      name: svcName,
      namespace: ns,
      labels: { "assembly-lime/sandbox": name },
    },
    spec: {
      selector: { "assembly-lime/sandbox": name },
      ports: [{ port: 80, targetPort: containerPort, protocol: "TCP" }],
    },
  };

  try {
    await core.createNamespacedService({ namespace: ns, body: service });
    log.info({ svcName, namespace: ns }, "sandbox service created");
  } catch (err) {
    const msg = k8sErrorBody(err);
    log.error({ err: msg, svcName, namespace: ns }, "failed to create sandbox service");
    // Pod already exists — continue, but ingress won't route
  }

  // 3. Create Ingress for external access
  const ingressName = name;
  const ingress: k8s.V1Ingress = {
    metadata: {
      name: ingressName,
      namespace: ns,
      annotations: {
        "nginx.ingress.kubernetes.io/proxy-body-size": "50m",
      },
    },
    spec: {
      ingressClassName: PREVIEW_INGRESS_CLASS,
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name: svcName, port: { number: 80 } },
                },
              },
            ],
          },
        },
      ],
    },
  };

  try {
    await networkingApi.createNamespacedIngress({ namespace: ns, body: ingress });
    log.info({ ingressName, host, namespace: ns }, "sandbox ingress created");
  } catch (err) {
    const msg = k8sErrorBody(err);
    log.error({ err: msg, ingressName, namespace: ns }, "failed to create sandbox ingress");
  }

  const sandboxUrl = `https://${host}`;

  const [row] = await db
    .insert(sandboxes)
    .values({
      tenantId,
      clusterId: input.clusterId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      k8sNamespace: ns,
      k8sPod: name,
      k8sService: svcName,
      k8sIngress: ingressName,
      sandboxUrl,
      status: "creating",
      portsJson: [{ containerPort, source: config.portSource }],
      envVarSetId: input.envVarSetId,
      createdBy: input.createdBy,
    })
    .returning();

  log.info({ sandboxId: row!.id, tenantId, pod: name, namespace: ns, port: containerPort, url: sandboxUrl }, "sandbox created");
  return row!;
}

// K8s implementation (internal)
async function k8sGetSandbox(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  if (!row.clusterId) return row;
  try {
    const kc = await getClusterClient(db, tenantId, row.clusterId);
    const core = kc.makeApiClient(k8s.CoreV1Api);
    const pod = await core.readNamespacedPod({ namespace: row.k8sNamespace, name: row.k8sPod });
    const phase = pod.status?.phase?.toLowerCase() ?? "unknown";
    const statusMap: Record<string, string> = {
      pending: "creating",
      running: "running",
      succeeded: "stopped",
      failed: "error",
    };
    const liveStatus = statusMap[phase] ?? row.status;

    if (liveStatus !== row.status) {
      await db.update(sandboxes).set({ status: liveStatus }).where(eq(sandboxes.id, sandboxId));
    }
    return { ...row, status: liveStatus };
  } catch {
    return row;
  }
}

// K8s implementation (internal)
async function k8sListSandboxes(db: Db, tenantId: number) {
  return db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.tenantId, tenantId));
}

// K8s implementation (internal)
async function k8sDestroySandbox(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  if (row.clusterId) {
    try {
      const kc = await getClusterClient(db, tenantId, row.clusterId);
      const core = kc.makeApiClient(k8s.CoreV1Api);
      const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

      // Delete in reverse order: Ingress → Service → Pod
      if (row.k8sIngress) {
        try {
          await networkingApi.deleteNamespacedIngress({ namespace: row.k8sNamespace, name: row.k8sIngress });
        } catch (err) {
          log.warn({ err: k8sErrorBody(err), sandboxId }, "failed to delete sandbox ingress");
        }
      }
      if (row.k8sService) {
        try {
          await core.deleteNamespacedService({ namespace: row.k8sNamespace, name: row.k8sService });
        } catch (err) {
          log.warn({ err: k8sErrorBody(err), sandboxId }, "failed to delete sandbox service");
        }
      }
      await core.deleteNamespacedPod({ namespace: row.k8sNamespace, name: row.k8sPod });
    } catch (err) {
      log.error({ err: k8sErrorBody(err), sandboxId }, "failed to delete sandbox pod");
    }
  }

  const [updated] = await db
    .update(sandboxes)
    .set({ status: "destroyed", destroyedAt: new Date() })
    .where(eq(sandboxes.id, sandboxId))
    .returning();

  log.info({ sandboxId, tenantId }, "sandbox destroyed");
  return updated;
}

// K8s implementation (internal)
async function k8sGetSandboxLogs(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  if (!row.clusterId) return null;
  try {
    const kc = await getClusterClient(db, tenantId, row.clusterId);
    const core = kc.makeApiClient(k8s.CoreV1Api);

    // Check pod phase — if still initializing, read init container logs
    try {
      const pod = await core.readNamespacedPod({ namespace: row.k8sNamespace, name: row.k8sPod });
      const phase = pod.status?.phase?.toLowerCase();
      const initStatuses = pod.status?.initContainerStatuses ?? [];
      const containerStatuses = pod.status?.containerStatuses ?? [];
      const isInitializing = phase === "pending" || initStatuses.some((s) => s.state?.running || s.state?.waiting);

      // Collect all available logs
      const parts: string[] = [];

      // Init container logs (always include if available)
      for (const initStatus of initStatuses) {
        if (initStatus.state?.terminated || initStatus.state?.running) {
          try {
            const initLogs = await core.readNamespacedPodLog({
              namespace: row.k8sNamespace,
              name: row.k8sPod,
              container: initStatus.name!,
              tailLines: 200,
            });
            if (initLogs) parts.push(`--- [init: ${initStatus.name}] ---\n${initLogs}`);
          } catch {
            // Container may not have logs yet
          }
        }
        // Log waiting state reason
        if (initStatus.state?.waiting) {
          parts.push(`--- [init: ${initStatus.name}] ---\nWaiting: ${initStatus.state.waiting.reason ?? "unknown"} — ${initStatus.state.waiting.message ?? ""}`);
        }
        // Log terminated error
        if (initStatus.state?.terminated && initStatus.state.terminated.exitCode !== 0) {
          parts.push(`Exit code: ${initStatus.state.terminated.exitCode} — ${initStatus.state.terminated.reason ?? ""} ${initStatus.state.terminated.message ?? ""}`);
        }
      }

      if (isInitializing) {
        return parts.join("\n\n") || "[Pod initializing — waiting for init containers to complete]";
      }

      // Main container logs
      for (const cs of containerStatuses) {
        if (cs.state?.waiting) {
          parts.push(`--- [${cs.name}] ---\nWaiting: ${cs.state.waiting.reason ?? "unknown"} — ${cs.state.waiting.message ?? ""}`);
        }
        if (cs.state?.terminated && cs.state.terminated.exitCode !== 0) {
          parts.push(`--- [${cs.name}] ---\nTerminated: exit ${cs.state.terminated.exitCode} — ${cs.state.terminated.reason ?? ""} ${cs.state.terminated.message ?? ""}`);
        }
      }

      try {
        const mainLogs = await core.readNamespacedPodLog({
          namespace: row.k8sNamespace,
          name: row.k8sPod,
          container: "sandbox",
          tailLines: 500,
        });
        if (mainLogs) parts.push(`--- [sandbox] ---\n${mainLogs}`);
      } catch {
        // Container not ready yet
      }

      return parts.join("\n\n") || "[No logs available yet]";
    } catch (err) {
      log.error({ err: k8sErrorBody(err), sandboxId }, "failed to read pod status for logs");
      return `[Error reading pod status: ${k8sErrorBody(err)}]`;
    }
  } catch (err) {
    log.error({ err: k8sErrorBody(err), sandboxId }, "failed to get sandbox logs");
    return `[Error: ${k8sErrorBody(err)}]`;
  }
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export interface ISandboxProvider {
  createSandbox(db: Db, tenantId: number, input: CreateSandboxInput): Promise<any>;
  getSandbox(db: Db, tenantId: number, sandboxId: number): Promise<any | null>;
  listSandboxes(db: Db, tenantId: number): Promise<any[]>;
  destroySandbox(db: Db, tenantId: number, sandboxId: number): Promise<any | null>;
  getSandboxLogs(db: Db, tenantId: number, sandboxId: number): Promise<string | null>;
}

class K8sSandboxProvider implements ISandboxProvider {
  createSandbox(db: Db, tenantId: number, input: CreateSandboxInput) {
    return k8sCreateSandbox(db, tenantId, input);
  }
  getSandbox(db: Db, tenantId: number, sandboxId: number) {
    return k8sGetSandbox(db, tenantId, sandboxId);
  }
  listSandboxes(db: Db, tenantId: number) {
    return k8sListSandboxes(db, tenantId);
  }
  destroySandbox(db: Db, tenantId: number, sandboxId: number) {
    return k8sDestroySandbox(db, tenantId, sandboxId);
  }
  getSandboxLogs(db: Db, tenantId: number, sandboxId: number) {
    return k8sGetSandboxLogs(db, tenantId, sandboxId);
  }
}

// Placeholder for future Daytona provider integration
class DaytonaSandboxProvider implements ISandboxProvider {
  async createSandbox(db: Db, tenantId: number, input: CreateSandboxInput): Promise<any> {
    // Look up repo + connector (GitHub token) to authenticate git operations
    const [repo] = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.id, input.repositoryId), eq(repositories.tenantId, tenantId)));
    if (!repo) throw new Error("Repository not found");

    const [connector] = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, repo.connectorId), eq(connectors.tenantId, tenantId)));
    if (!connector) throw new Error("Connector not found for repository");

    const gitToken = decryptToken(connector.accessTokenEnc);

    // Detect runtime/port from repo (cached if available)
    let config = await loadCachedConfig(db, tenantId, input.repositoryId);
    if (!config) {
      log.info({ repo: repo.fullName, branch: input.branch }, "detecting sandbox config from repo (daytona)");
      config = await detectSandboxConfig(gitToken, repo.owner, repo.name, input.branch);
      await saveSandboxConfig(db, tenantId, input.repositoryId, config);
    }

    // Create Daytona sandbox (uses DAYTONA_* env or explicit config)
    const daytona = new Daytona();
    const labels = {
      "assembly-lime/tenantId": String(tenantId),
      "assembly-lime/repositoryId": String(input.repositoryId),
      "assembly-lime/branch": input.branch,
    } as Record<string, string>;

    // Map detected language to Daytona SDK language
    const langMap: Record<string, string> = {
      node: "typescript", python: "python", ruby: "ruby", go: "go",
      rust: "rust", java: "java", php: "php", dotnet: "dotnet",
    };
    const detectedLang = config.detectedFrom?.split(/[@(]/)[0]?.trim() ?? "node";
    const sdkLang = langMap[detectedLang] ?? "typescript";

    const sb = await daytona.create({
      language: sdkLang,
      public: false, // private — use signed URLs for preview access
      labels,
      autoStopInterval: 60,
    });

    // Clone repo into the sandbox's working directory
    try {
      const cloneUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
      await sb.git.clone(cloneUrl, repo.name, input.branch, undefined, "x-access-token", gitToken);
      log.info({ sandboxId: sb.id, repo: repo.fullName }, "daytona: repo cloned");
    } catch (err) {
      log.error({ err, repo: repo.fullName }, "daytona: git clone failed");
    }

    // Generate a signed preview URL (1 hour TTL) for private sandbox access
    let sandboxUrl: string | null = null;
    try {
      const signed = await sb.getSignedPreviewUrl(config.port, 3600);
      sandboxUrl = signed?.url ?? null;
    } catch {
      sandboxUrl = null;
    }

    // Persist a row representing this sandbox run. We reuse existing fields;
    // provider metadata is implicit (k8sNamespace="daytona").
    const [row] = await db
      .insert(sandboxes)
      .values({
        tenantId,
        clusterId: null,
        repositoryId: input.repositoryId,
        branch: input.branch,
        k8sNamespace: "daytona",
        k8sPod: sb.id, // store Daytona sandbox ID
        k8sService: null,
        k8sIngress: null,
        sandboxUrl,
        status: "creating",
        portsJson: [{ containerPort: config.port, source: config.portSource, provider: "daytona" }],
        envVarSetId: input.envVarSetId,
        createdBy: input.createdBy,
      })
      .returning();

    log.info({ sandboxId: row!.id, provider: "daytona", daytonaId: sb.id }, "sandbox created (daytona)");
    return row!;
  }

  async getSandbox(db: Db, tenantId: number, sandboxId: number): Promise<any | null> {
    const [row] = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
    if (!row) return null;
    if (row.k8sNamespace !== "daytona" || !row.k8sPod) return row;
    try {
      const daytona = new Daytona();
      const sb = await daytona.get(row.k8sPod);
      // Map Daytona state to our status
      const state = (sb.state ?? "").toString().toLowerCase();
      const map: Record<string, string> = {
        started: "running",
        starting: "creating",
        stopped: "stopped",
        error: "error",
        destroying: "destroying",
        destroyed: "destroyed",
      };
      const newStatus = map[state] ?? row.status;
      if (newStatus !== row.status) {
        const [updated] = await db
          .update(sandboxes)
          .set({ status: newStatus })
          .where(eq(sandboxes.id, sandboxId))
          .returning();
        return updated!;
      }
    } catch (err) {
      log.warn({ err, sandboxId }, "daytona: get sandbox failed; returning cached row");
    }
    return row;
  }

  async listSandboxes(db: Db, tenantId: number): Promise<any[]> {
    return db
      .select()
      .from(sandboxes)
      .where(eq(sandboxes.tenantId, tenantId));
  }

  async destroySandbox(db: Db, tenantId: number, sandboxId: number): Promise<any | null> {
    const [row] = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
    if (!row) return null;

    if (row.k8sNamespace === "daytona" && row.k8sPod) {
      try {
        const daytona = new Daytona();
        const sb = await daytona.get(row.k8sPod);
        await sb.delete(60);
      } catch (err) {
        log.warn({ err, sandboxId }, "daytona: delete failed (continuing to mark destroyed)");
      }
    }

    const [updated] = await db
      .update(sandboxes)
      .set({ status: "destroyed", destroyedAt: new Date() })
      .where(eq(sandboxes.id, sandboxId))
      .returning();
    return updated;
  }

  async getSandboxLogs(db: Db, tenantId: number, sandboxId: number): Promise<string | null> {
    const [row] = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
    if (!row) return null;
    if (row.k8sNamespace !== "daytona") return null;
    // TODO: Integrate Daytona session logs or process logs as needed
    return "[Daytona provider] Use Run details or start commands to view output.";
  }
}

function getSandboxProvider(): ISandboxProvider {
  const provider = process.env.SANDBOX_PROVIDER?.toLowerCase();
  if (provider === "daytona") return new DaytonaSandboxProvider();
  return new K8sSandboxProvider();
}

// Public API — delegates to selected provider
export async function createSandbox(db: Db, tenantId: number, input: CreateSandboxInput) {
  return getSandboxProvider().createSandbox(db, tenantId, input);
}

export async function getSandbox(db: Db, tenantId: number, sandboxId: number) {
  return getSandboxProvider().getSandbox(db, tenantId, sandboxId);
}

export async function listSandboxes(db: Db, tenantId: number) {
  return getSandboxProvider().listSandboxes(db, tenantId);
}

export async function destroySandbox(db: Db, tenantId: number, sandboxId: number) {
  return getSandboxProvider().destroySandbox(db, tenantId, sandboxId);
}

export async function getSandboxLogs(db: Db, tenantId: number, sandboxId: number) {
  return getSandboxProvider().getSandboxLogs(db, tenantId, sandboxId);
}
