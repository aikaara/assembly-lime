import { GitBranch } from "lucide-react";

type Props = {
  uatBranch: string;
  prodBranch: string;
  defaultBranch: string;
  onChange: (field: "uatBranch" | "prodBranch", value: string) => void;
};

export function BranchSelector({ uatBranch, prodBranch, defaultBranch, onChange }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-zinc-400" />
        Branch Settings
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">UAT Branch</label>
          <input
            type="text"
            value={uatBranch}
            placeholder={defaultBranch}
            onChange={(e) => onChange("uatBranch", e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Production Branch</label>
          <input
            type="text"
            value={prodBranch}
            placeholder={defaultBranch}
            onChange={(e) => onChange("prodBranch", e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
