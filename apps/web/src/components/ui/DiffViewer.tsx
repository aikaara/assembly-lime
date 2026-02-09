export function DiffViewer({
  diff,
  summary,
}: {
  diff: string;
  summary?: string;
}) {
  const lines = diff.split("\n");

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
      {summary && (
        <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          {summary}
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-xs leading-5 font-mono">
        {lines.map((line, i) => {
          let className = "text-zinc-400";
          if (line.startsWith("+")) className = "text-emerald-400";
          else if (line.startsWith("-")) className = "text-red-400";
          else if (line.startsWith("@@")) className = "text-blue-400";
          else if (line.startsWith("diff ") || line.startsWith("index "))
            className = "text-zinc-500 font-bold";

          return (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 select-none text-right pr-2 text-zinc-600">
                {i + 1}
              </span>
              <span className={className}>{line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
