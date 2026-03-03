import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { GitBranch, GitFork } from "lucide-react";

export type RepoNodeData = {
  fullName: string;
  isEnabled: boolean;
  depCount: number;
  hasFork: boolean;
};

export type RepoNodeType = Node<RepoNodeData, "repo">;

export function RepoNode({ data }: NodeProps<RepoNodeType>) {
  const { fullName, isEnabled, depCount, hasFork } = data;
  const [owner, repoName] = fullName.split("/");

  return (
    <div
      className={`rounded-xl border px-4 py-3 shadow-lg min-w-[200px] backdrop-blur transition-colors ${
        isEnabled
          ? "border-zinc-600 bg-zinc-800/95 text-zinc-100 hover:border-zinc-500"
          : "border-zinc-700 bg-zinc-900/95 text-zinc-500 hover:border-zinc-600"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-zinc-500 !w-2 !h-2 !border-0"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <GitBranch className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        <span className="text-sm font-semibold truncate">{repoName}</span>
        <span
          className={`ml-auto h-2 w-2 rounded-full shrink-0 ${
            isEnabled ? "bg-lime-500" : "bg-zinc-600"
          }`}
        />
      </div>

      <p className="text-[10px] text-zinc-500 truncate mb-2">{owner}</p>

      <div className="flex items-center gap-1.5">
        {depCount > 0 && (
          <span className="rounded-md bg-zinc-700/70 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {depCount} dep{depCount !== 1 ? "s" : ""}
          </span>
        )}
        {hasFork && (
          <span className="flex items-center gap-0.5 rounded-md bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-300">
            <GitFork className="h-2.5 w-2.5" />
            fork
          </span>
        )}
        {isEnabled && depCount === 0 && !hasFork && (
          <span className="text-[10px] text-zinc-600">No dependencies</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-zinc-500 !w-2 !h-2 !border-0"
      />
    </div>
  );
}
