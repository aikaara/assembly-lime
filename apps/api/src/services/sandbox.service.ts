import { eq, and } from "drizzle-orm";
import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { sandboxes, repositories, connectors, repositoryConfigs } from "@assembly-lime/shared/db/schema";
import { getClusterClient } from "./k8s-cluster.service";
import { tenantNamespace, ensureGitCredentialSecret } from "./namespace-provisioner.service";
import { decryptToken } from "../lib/encryption";
import { PREVIEW_DOMAIN, PREVIEW_INGRESS_CLASS } from "../lib/k8s";
import { childLogger } from "../lib/logger";

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

/** Detect start command and port for the primary language. */
async function detectStartConfig(
  token: string, owner: string, repoName: string, branch: string, primaryLang: string
): Promise<{ startCommand: string; port: number; portSource: string; startScript: string | null }> {

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

        const cmd = startScript ? `npm run ${startScript}` : pkg.main ? `node ${pkg.main}` : "node .";
        return { startCommand: `npm install && ${cmd}`, port, portSource, startScript };
      } catch { /* fall through */ }
    }
    return { startCommand: "npm install && npm start", port: 3000, portSource: "Node.js default", startScript: "start" };
  }

  if (primaryLang === "ruby") {
    const gemfile = await githubFileContent(token, owner, repoName, "Gemfile", branch);
    const isRails = gemfile?.includes("rails") ?? false;
    const hasPuma = gemfile?.includes("puma") ?? false;
    if (isRails) {
      return {
        startCommand: "bundle install && bundle exec rails s -b 0.0.0.0 -p 3000",
        port: 3000, portSource: "Rails default", startScript: "rails server",
      };
    }
    if (hasPuma) {
      return {
        startCommand: "bundle install && bundle exec puma -b tcp://0.0.0.0:9292",
        port: 9292, portSource: "Puma default", startScript: "puma",
      };
    }
    // Check for Rakefile, config.ru
    const configRu = await githubFileContent(token, owner, repoName, "config.ru", branch);
    if (configRu) {
      return {
        startCommand: "bundle install && bundle exec rackup -o 0.0.0.0 -p 9292",
        port: 9292, portSource: "Rack default", startScript: "rackup",
      };
    }
    return {
      startCommand: "bundle install && bundle exec ruby app.rb || bundle exec ruby main.rb",
      port: 4567, portSource: "Sinatra default", startScript: null,
    };
  }

  if (primaryLang === "python") {
    const reqs = await githubFileContent(token, owner, repoName, "requirements.txt", branch);
    const isDjango = reqs?.toLowerCase().includes("django") ?? false;
    const isFlask = reqs?.toLowerCase().includes("flask") ?? false;
    const isFastapi = reqs?.toLowerCase().includes("fastapi") ?? false;
    if (isDjango) {
      return {
        startCommand: "pip install -r requirements.txt && python manage.py runserver 0.0.0.0:8000",
        port: 8000, portSource: "Django default", startScript: "manage.py runserver",
      };
    }
    if (isFastapi) {
      return {
        startCommand: "pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000",
        port: 8000, portSource: "FastAPI default", startScript: "uvicorn",
      };
    }
    if (isFlask) {
      return {
        startCommand: "pip install -r requirements.txt && python -m flask run --host=0.0.0.0 --port=5000",
        port: 5000, portSource: "Flask default", startScript: "flask run",
      };
    }
    return {
      startCommand: "pip install -r requirements.txt && python app.py || python main.py || python server.py",
      port: 5000, portSource: "Python default", startScript: null,
    };
  }

  if (primaryLang === "go") {
    return { startCommand: "go run .", port: 8080, portSource: "Go default", startScript: null };
  }

  if (primaryLang === "rust") {
    return { startCommand: "cargo run --release", port: 8080, portSource: "Rust default", startScript: null };
  }

  if (primaryLang === "java") {
    // Check for Maven vs Gradle
    const pomXml = await githubFileContent(token, owner, repoName, "pom.xml", branch);
    if (pomXml) {
      const isSpringBoot = pomXml.includes("spring-boot");
      return {
        startCommand: isSpringBoot
          ? "./mvnw spring-boot:run -Dserver.port=8080 || mvn spring-boot:run -Dserver.port=8080"
          : "./mvnw package -DskipTests && java -jar target/*.jar || mvn package -DskipTests && java -jar target/*.jar",
        port: 8080,
        portSource: isSpringBoot ? "Spring Boot default" : "Java default",
        startScript: isSpringBoot ? "spring-boot:run" : "mvn package",
      };
    }
    const buildGradle = await githubFileContent(token, owner, repoName, "build.gradle", branch)
      ?? await githubFileContent(token, owner, repoName, "build.gradle.kts", branch);
    if (buildGradle) {
      const isSpringBoot = buildGradle.includes("spring-boot") || buildGradle.includes("org.springframework.boot");
      return {
        startCommand: isSpringBoot
          ? "./gradlew bootRun --args='--server.port=8080' || gradle bootRun --args='--server.port=8080'"
          : "./gradlew run || gradle run",
        port: 8080,
        portSource: isSpringBoot ? "Spring Boot default" : "Java default",
        startScript: isSpringBoot ? "bootRun" : "gradle run",
      };
    }
    return { startCommand: "javac *.java && java Main", port: 8080, portSource: "Java default", startScript: null };
  }

  if (primaryLang === "php") {
    const composerJson = await githubFileContent(token, owner, repoName, "composer.json", branch);
    const isLaravel = composerJson?.includes("laravel/framework") ?? false;
    const isSymfony = composerJson?.includes("symfony/framework-bundle") ?? false;
    if (isLaravel) {
      return {
        startCommand: "composer install --no-interaction && php artisan serve --host=0.0.0.0 --port=8000",
        port: 8000, portSource: "Laravel default", startScript: "artisan serve",
      };
    }
    if (isSymfony) {
      return {
        startCommand: "composer install --no-interaction && php -S 0.0.0.0:8000 -t public/",
        port: 8000, portSource: "Symfony default", startScript: "php built-in server",
      };
    }
    // Check for index.php
    return {
      startCommand: "composer install --no-interaction 2>/dev/null; php -S 0.0.0.0:8000",
      port: 8000, portSource: "PHP default", startScript: "php built-in server",
    };
  }

  if (primaryLang === "elixir") {
    const mixExs = await githubFileContent(token, owner, repoName, "mix.exs", branch);
    const isPhoenix = mixExs?.includes(":phoenix") ?? false;
    if (isPhoenix) {
      return {
        startCommand: "mix deps.get && mix phx.server",
        port: 4000, portSource: "Phoenix default", startScript: "phx.server",
      };
    }
    return {
      startCommand: "mix deps.get && mix run --no-halt",
      port: 4000, portSource: "Elixir default", startScript: "mix run",
    };
  }

  if (primaryLang === "dotnet") {
    return {
      startCommand: "dotnet restore && dotnet run --urls http://0.0.0.0:5000",
      port: 5000, portSource: ".NET default", startScript: "dotnet run",
    };
  }

  if (primaryLang === "scala") {
    const buildSbt = await githubFileContent(token, owner, repoName, "build.sbt", branch);
    const isPlayFramework = buildSbt?.includes("PlayScala") ?? false;
    if (isPlayFramework) {
      return {
        startCommand: "sbt run",
        port: 9000, portSource: "Play Framework default", startScript: "sbt run",
      };
    }
    return {
      startCommand: "sbt run",
      port: 8080, portSource: "Scala default", startScript: "sbt run",
    };
  }

  if (primaryLang === "swift") {
    return {
      startCommand: "swift build && swift run",
      port: 8080, portSource: "Swift default", startScript: "swift run",
    };
  }

  if (primaryLang === "zig") {
    return {
      startCommand: "zig build run",
      port: 8080, portSource: "Zig default", startScript: "zig build run",
    };
  }

  if (primaryLang === "dart" || primaryLang === "flutter") {
    return {
      startCommand: "dart pub get && dart run",
      port: 8080, portSource: "Dart default", startScript: "dart run",
    };
  }

  // Universal fallback: keep the container alive for manual inspection
  return { startCommand: "sleep infinity", port: 3000, portSource: "fallback", startScript: null };
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
  const startConfig = await detectStartConfig(token, owner, repoName, branch, primary.language);

  // Also check .env files for PORT override
  let { port, portSource } = startConfig;
  const envExample = await githubFileContent(token, owner, repoName, ".env.example", branch)
    ?? await githubFileContent(token, owner, repoName, ".env.sample", branch);
  if (envExample) {
    const envPortMatch = envExample.match(/^PORT\s*=\s*(\d{3,5})/m);
    if (envPortMatch?.[1]) {
      port = parseInt(envPortMatch[1], 10);
      portSource = ".env";
    }
  }

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

type CreateSandboxInput = {
  repositoryId: number;
  branch: string;
  clusterId: number;
  tenantSlug: string;
  envVarSetId?: number;
  createdBy?: number;
};

export async function createSandbox(db: Db, tenantId: number, input: CreateSandboxInput) {
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

export async function getSandbox(db: Db, tenantId: number, sandboxId: number) {
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

export async function listSandboxes(db: Db, tenantId: number) {
  return db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.tenantId, tenantId));
}

export async function destroySandbox(db: Db, tenantId: number, sandboxId: number) {
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

export async function getSandboxLogs(db: Db, tenantId: number, sandboxId: number) {
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
