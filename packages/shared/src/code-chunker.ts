/**
 * Code chunking engine for semantic code search.
 * Splits source files into meaningful chunks (functions, classes, segments)
 * for embedding and retrieval.
 */

export interface CodeChunk {
  filePath: string;
  chunkType: string; // "function" | "class" | "interface" | "type" | "method" | "struct" | "enum" | "trait" | "impl" | "file_segment"
  symbolName: string | null;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  contextHeader: string | null;
}

// ── Language detection ───────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  swift: "swift",
  php: "php",
  lua: "lua",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  toml: "toml",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  r: "r",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  zig: "zig",
  nim: "nim",
  proto: "protobuf",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "unknown";
}

// ── File filtering ──────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  "coverage",
  ".turbo",
  ".cache",
]);

const SKIP_EXTENSIONS = new Set([
  "lock",
  "lockb",
  "min.js",
  "min.css",
  "map",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp3",
  "mp4",
  "webm",
  "pdf",
  "zip",
  "tar",
  "gz",
  "bin",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "pb",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
]);

const MAX_FILE_SIZE = 200_000; // 200KB
const MAX_CHUNK_CHARS = 12_000;

export function shouldSkipFile(filePath: string): boolean {
  const parts = filePath.split("/");
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }

  const fileName = parts[parts.length - 1] ?? "";
  if (SKIP_FILES.has(fileName)) return true;
  if (fileName.startsWith(".")) return true;

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (SKIP_EXTENSIONS.has(ext)) return true;

  // Check for min.js / min.css
  if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css")) return true;

  return false;
}

// ── Symbol patterns per language ────────────────────────────────────

interface SymbolPattern {
  regex: RegExp;
  chunkType: string;
  nameGroup: number;
}

const BRACE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "go",
  "rust",
  "java",
  "kotlin",
  "csharp",
  "cpp",
  "c",
  "swift",
  "dart",
  "scala",
  "php",
]);

const INDENT_LANGUAGES = new Set(["python", "ruby"]);

function getSymbolPatterns(language: string): SymbolPattern[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return [
        { regex: /^export\s+(?:async\s+)?function\s+(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^export\s+(?:default\s+)?class\s+(\w+)/, chunkType: "class", nameGroup: 1 },
        { regex: /^export\s+(?:type|interface)\s+(\w+)/, chunkType: "interface", nameGroup: 1 },
        { regex: /^(?:async\s+)?function\s+(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^class\s+(\w+)/, chunkType: "class", nameGroup: 1 },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/, chunkType: "function", nameGroup: 1 },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/, chunkType: "function", nameGroup: 1 },
      ];
    case "python":
      return [
        { regex: /^(?:async\s+)?def\s+(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^class\s+(\w+)/, chunkType: "class", nameGroup: 1 },
      ];
    case "go":
      return [
        { regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^type\s+(\w+)\s+struct/, chunkType: "struct", nameGroup: 1 },
        { regex: /^type\s+(\w+)\s+interface/, chunkType: "interface", nameGroup: 1 },
      ];
    case "rust":
      return [
        { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^(?:pub\s+)?struct\s+(\w+)/, chunkType: "struct", nameGroup: 1 },
        { regex: /^(?:pub\s+)?enum\s+(\w+)/, chunkType: "enum", nameGroup: 1 },
        { regex: /^impl(?:<[^>]*>)?\s+(\w+)/, chunkType: "impl", nameGroup: 1 },
        { regex: /^(?:pub\s+)?trait\s+(\w+)/, chunkType: "trait", nameGroup: 1 },
      ];
    case "java":
    case "kotlin":
    case "csharp":
      return [
        { regex: /^(?:public|private|protected|static|abstract|final|\s)*class\s+(\w+)/, chunkType: "class", nameGroup: 1 },
        { regex: /^(?:public|private|protected|static|abstract|final|\s)*interface\s+(\w+)/, chunkType: "interface", nameGroup: 1 },
        { regex: /^(?:public|private|protected|static|abstract|final|\s)*(?:async\s+)?(?:\w+(?:<[^>]*>)?\s+)+(\w+)\s*\(/, chunkType: "method", nameGroup: 1 },
      ];
    case "ruby":
      return [
        { regex: /^def\s+(\w+)/, chunkType: "function", nameGroup: 1 },
        { regex: /^class\s+(\w+)/, chunkType: "class", nameGroup: 1 },
        { regex: /^module\s+(\w+)/, chunkType: "class", nameGroup: 1 },
      ];
    default:
      return [];
  }
}

// ── Symbol body extraction ──────────────────────────────────────────

interface SymbolMatch {
  chunkType: string;
  symbolName: string;
  startLine: number;
  endLine: number;
  contextStartLine: number;
}

function extractSymbols(lines: string[], language: string): SymbolMatch[] {
  const patterns = getSymbolPatterns(language);
  if (patterns.length === 0) return [];

  const symbols: SymbolMatch[] = [];
  const isBrace = BRACE_LANGUAGES.has(language);
  const isIndent = INDENT_LANGUAGES.has(language);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimStart();

    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;

      const symbolName = match[pattern.nameGroup] ?? "unknown";
      const startLine = i;

      // Get 3 lines of leading context (comments/imports above)
      const contextStartLine = Math.max(0, i - 3);

      let endLine: number;

      if (isBrace) {
        endLine = findBraceEnd(lines, i);
      } else if (isIndent) {
        endLine = findIndentEnd(lines, i);
      } else {
        endLine = Math.min(i + 30, lines.length - 1); // fallback
      }

      symbols.push({
        chunkType: pattern.chunkType,
        symbolName,
        startLine,
        endLine,
        contextStartLine,
      });

      // Skip past the symbol body to avoid nested matches
      i = endLine;
      break;
    }
  }

  return symbols;
}

function findBraceEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let foundOpen = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) return i;
      }
    }
  }

  // If we never found a closing brace, return a reasonable end
  return Math.min(startLine + 50, lines.length - 1);
}

function findIndentEnd(lines: string[], startLine: number): number {
  // For Python/Ruby: find the base indent of the def/class line
  const baseLine = lines[startLine]!;
  const baseIndent = baseLine.length - baseLine.trimStart().length;

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue; // skip blank lines

    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) {
      return i - 1;
    }
  }

  return lines.length - 1;
}

// ── Main chunking function ──────────────────────────────────────────

export function chunkFile(filePath: string, content: string, _repoName?: string): CodeChunk[] {
  if (shouldSkipFile(filePath)) return [];
  if (content.length > MAX_FILE_SIZE) return [];

  const language = detectLanguage(filePath);
  if (language === "unknown") return [];

  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const symbols = extractSymbols(lines, language);
  const chunks: CodeChunk[] = [];

  if (symbols.length > 0) {
    // Create chunks from symbols
    for (const sym of symbols) {
      const contextHeader = sym.contextStartLine < sym.startLine
        ? lines.slice(sym.contextStartLine, sym.startLine).join("\n")
        : null;

      let chunkContent = lines.slice(sym.startLine, sym.endLine + 1).join("\n");
      if (chunkContent.length > MAX_CHUNK_CHARS) {
        chunkContent = chunkContent.slice(0, MAX_CHUNK_CHARS);
      }

      chunks.push({
        filePath,
        chunkType: sym.chunkType,
        symbolName: sym.symbolName,
        language,
        startLine: sym.startLine + 1, // 1-indexed
        endLine: sym.endLine + 1,
        content: chunkContent,
        contextHeader,
      });
    }

    // Fill gaps between symbols > 15 lines with file_segment chunks
    const sortedSymbols = [...symbols].sort((a, b) => a.startLine - b.startLine);

    // Gap before first symbol
    if (sortedSymbols[0]!.startLine > 15) {
      addSegmentChunk(chunks, filePath, language, lines, 0, sortedSymbols[0]!.startLine - 1);
    }

    // Gaps between symbols
    for (let i = 0; i < sortedSymbols.length - 1; i++) {
      const gapStart = sortedSymbols[i]!.endLine + 1;
      const gapEnd = sortedSymbols[i + 1]!.startLine - 1;
      if (gapEnd - gapStart > 15) {
        addSegmentChunk(chunks, filePath, language, lines, gapStart, gapEnd);
      }
    }

    // Gap after last symbol
    const lastEnd = sortedSymbols[sortedSymbols.length - 1]!.endLine;
    if (lines.length - 1 - lastEnd > 15) {
      addSegmentChunk(chunks, filePath, language, lines, lastEnd + 1, lines.length - 1);
    }
  } else {
    // No symbols found — use sliding window
    const windowSize = 120;
    const overlap = 30;

    for (let start = 0; start < lines.length; start += windowSize - overlap) {
      const end = Math.min(start + windowSize - 1, lines.length - 1);
      let chunkContent = lines.slice(start, end + 1).join("\n");
      if (chunkContent.length > MAX_CHUNK_CHARS) {
        chunkContent = chunkContent.slice(0, MAX_CHUNK_CHARS);
      }

      if (chunkContent.trim()) {
        chunks.push({
          filePath,
          chunkType: "file_segment",
          symbolName: null,
          language,
          startLine: start + 1,
          endLine: end + 1,
          content: chunkContent,
          contextHeader: null,
        });
      }

      if (end >= lines.length - 1) break;
    }
  }

  return chunks;
}

function addSegmentChunk(
  chunks: CodeChunk[],
  filePath: string,
  language: string,
  lines: string[],
  startIdx: number,
  endIdx: number,
): void {
  let content = lines.slice(startIdx, endIdx + 1).join("\n");
  if (content.length > MAX_CHUNK_CHARS) {
    content = content.slice(0, MAX_CHUNK_CHARS);
  }
  if (!content.trim()) return;

  chunks.push({
    filePath,
    chunkType: "file_segment",
    symbolName: null,
    language,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    content,
    contextHeader: null,
  });
}
