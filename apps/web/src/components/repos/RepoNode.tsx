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
  const [, repoName] = fullName.split("/");

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-md min-w-[180px] ${
        isEnabled
          ? "border-zinc-600 bg-zinc-800 text-zinc-100"
          : "border-zinc-700 bg-zinc-900 text-zinc-500"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-500 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        <span className="text-sm font-semibold truncate">{repoName}</span>
        <span
          className={`ml-auto h-2 w-2 rounded-full shrink-0 ${
            isEnabled ? "bg-emerald-500" : "bg-zinc-600"
          }`}
        />
      </div>

      <p className="text-[10px] text-zinc-500 truncate mb-2">{fullName}</p>

      <div className="flex items-center gap-2 text-[10px]">
        {depCount > 0 && (
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
            {depCount} dep{depCount !== 1 ? "s" : ""}
          </span>
        )}
        {hasFork && (
          <span className="flex items-center gap-0.5 rounded bg-purple-900/50 px-1.5 py-0.5 text-purple-300">
            <GitFork className="h-2.5 w-2.5" />
            forked
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500 !w-2 !h-2" />
    </div>
  );
}
