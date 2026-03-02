interface SearchResult {
  id: string;
  repositoryId: string;
  repoFullName: string;
  filePath: string;
  chunkType: string;
  symbolName: string | null;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  contextHeader: string | null;
  commitSha: string | null;
  similarity: number;
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  const simPct = (result.similarity * 100).toFixed(1);

  const chunkBadgeColor =
    result.chunkType === "function" || result.chunkType === "method"
      ? "bg-blue-900/50 text-blue-300"
      : result.chunkType === "class" || result.chunkType === "struct"
        ? "bg-purple-900/50 text-purple-300"
        : result.chunkType === "interface" || result.chunkType === "type"
          ? "bg-cyan-900/50 text-cyan-300"
          : "bg-zinc-700 text-zinc-300";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center rounded-md bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-300">
              {result.repoFullName}
            </span>
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${chunkBadgeColor}`}>
              {result.chunkType}
            </span>
            <span className="inline-flex items-center rounded-md bg-zinc-700 px-2 py-0.5 text-xs font-medium text-zinc-300">
              {result.language}
            </span>
          </div>
          <p className="mt-1 text-sm font-mono text-zinc-200 truncate">
            {result.filePath}
            <span className="text-zinc-500">:{result.startLine}-{result.endLine}</span>
          </p>
          {result.symbolName && (
            <p className="text-xs text-zinc-400 mt-0.5">
              Symbol: <span className="font-mono text-zinc-300">{result.symbolName}</span>
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs font-mono text-emerald-400">{simPct}%</span>
      </div>

      <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs font-mono text-zinc-300 max-h-64 overflow-y-auto">
        {result.content.length > 1500
          ? result.content.slice(0, 1500) + "\n..."
          : result.content}
      </pre>
    </div>
  );
}
