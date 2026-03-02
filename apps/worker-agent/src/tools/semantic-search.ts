import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "../agent/emitter.js";

// ── semantic_search ─────────────────────────────────────────────────

const SemanticSearchParams = Type.Object({
  query: Type.String({ description: "Natural language search query (e.g. 'authentication middleware', 'rate limiting logic')" }),
  repository: Type.Optional(Type.String({ description: "Filter to a specific repository full name (e.g. 'owner/repo')" })),
  language: Type.Optional(Type.String({ description: "Filter by programming language (e.g. 'typescript', 'python')" })),
  limit: Type.Optional(Type.Number({ description: "Max results to return (default 10, max 30)" })),
});

export function createSemanticSearchTool(
  emitter: AgentEventEmitter,
): AgentTool<typeof SemanticSearchParams> {
  return {
    name: "semantic_search",
    label: "Semantic Code Search",
    description:
      "Search across all indexed repositories using natural language. " +
      "Finds relevant code by meaning, not just exact text matching. " +
      "Use this to find implementations, patterns, or code related to a concept.",
    parameters: SemanticSearchParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const results = await emitter.semanticSearch(
        params.query,
        {
          repository: params.repository,
          language: params.language,
          limit: params.limit,
        },
        "query",
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found for this query. The repositories may not be indexed yet, or try a different search query." }],
          details: {},
        };
      }

      const formatted = results.map((r, i) => {
        const sim = (r.similarity * 100).toFixed(1);
        const symbol = r.symbolName ? ` (${r.chunkType}: ${r.symbolName})` : "";
        const snippet = r.content.length > 500 ? r.content.slice(0, 500) + "..." : r.content;
        return `### ${i + 1}. ${r.repoFullName} — ${r.filePath}:${r.startLine}-${r.endLine}${symbol} [${sim}%]\n\`\`\`${r.language}\n${snippet}\n\`\`\``;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} result(s):\n\n${formatted}` }],
        details: {},
      };
    },
  };
}

// ── find_similar_code ───────────────────────────────────────────────

const FindSimilarCodeParams = Type.Object({
  code: Type.String({ description: "A code snippet to find similar implementations for" }),
  repository: Type.Optional(Type.String({ description: "Filter to a specific repository" })),
  language: Type.Optional(Type.String({ description: "Filter by programming language" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
});

export function createFindSimilarCodeTool(
  emitter: AgentEventEmitter,
): AgentTool<typeof FindSimilarCodeParams> {
  return {
    name: "find_similar_code",
    label: "Find Similar Code",
    description:
      "Find code that is structurally or semantically similar to a given code snippet. " +
      "Useful for finding duplicate logic, similar patterns, or related implementations.",
    parameters: FindSimilarCodeParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const results = await emitter.semanticSearch(
        params.code,
        {
          repository: params.repository,
          language: params.language,
          limit: params.limit,
        },
        "document",
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No similar code found." }],
          details: {},
        };
      }

      const formatted = results.map((r, i) => {
        const sim = (r.similarity * 100).toFixed(1);
        const symbol = r.symbolName ? ` (${r.chunkType}: ${r.symbolName})` : "";
        const snippet = r.content.length > 500 ? r.content.slice(0, 500) + "..." : r.content;
        return `### ${i + 1}. ${r.repoFullName} — ${r.filePath}:${r.startLine}-${r.endLine}${symbol} [${sim}%]\n\`\`\`${r.language}\n${snippet}\n\`\`\``;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} similar code block(s):\n\n${formatted}` }],
        details: {},
      };
    },
  };
}

// ── find_usages ─────────────────────────────────────────────────────

const FindUsagesParams = Type.Object({
  symbol: Type.String({ description: "Symbol name to find usages of (function, class, type, etc.)" }),
  repository: Type.Optional(Type.String({ description: "Filter to a specific repository" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
});

export function createFindUsagesTool(
  emitter: AgentEventEmitter,
): AgentTool<typeof FindUsagesParams> {
  return {
    name: "find_usages",
    label: "Find Symbol Usages",
    description:
      "Find where a symbol (function, class, type, variable) is used across all repositories. " +
      "Searches by symbol name using semantic matching to find imports, calls, and references.",
    parameters: FindUsagesParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const results = await emitter.semanticSearch(
        params.symbol,
        {
          repository: params.repository,
          limit: params.limit,
        },
        "query",
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No usages found for "${params.symbol}".` }],
          details: {},
        };
      }

      const formatted = results.map((r, i) => {
        const sim = (r.similarity * 100).toFixed(1);
        const symbol = r.symbolName ? ` (${r.chunkType}: ${r.symbolName})` : "";
        const snippet = r.content.length > 400 ? r.content.slice(0, 400) + "..." : r.content;
        return `### ${i + 1}. ${r.repoFullName} — ${r.filePath}:${r.startLine}-${r.endLine}${symbol} [${sim}%]\n\`\`\`${r.language}\n${snippet}\n\`\`\``;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} usage(s) of "${params.symbol}":\n\n${formatted}` }],
        details: {},
      };
    },
  };
}
