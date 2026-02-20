import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

export function ApprovalBar({
  onApprove,
  onReject,
}: {
  onApprove: () => void;
  onReject: () => void;
}) {
  const [acting, setActing] = useState(false);

  async function handleApprove() {
    setActing(true);
    try {
      onApprove();
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    setActing(true);
    try {
      onReject();
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-amber-900/40 bg-amber-950/15 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-sm text-amber-300 flex-1">
          Agent is awaiting your approval to proceed.
        </span>
        <button
          onClick={handleReject}
          disabled={acting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={acting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          Approve
        </button>
      </div>
    </div>
  );
}
