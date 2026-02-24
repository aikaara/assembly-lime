import { useState } from "react";
import { KeyRound, Send, SkipForward } from "lucide-react";

export function EnvVarsInputBar({
  keys,
  envFile,
  onSubmit,
  onSkip,
}: {
  keys: string[];
  envFile: string;
  onSubmit: (vars: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(keys.map((k) => [k, ""])),
  );
  const [acting, setActing] = useState(false);

  const filledCount = Object.values(values).filter((v) => v.trim()).length;

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setActing(true);
    try {
      // Only send non-empty values
      const filled: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim()) filled[k] = v.trim();
      }
      onSubmit(filled);
    } finally {
      setActing(false);
    }
  }

  async function handleSkip() {
    setActing(true);
    try {
      onSkip();
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-blue-900/40 bg-blue-950/15 px-4 py-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-4 w-4 text-blue-400 shrink-0" />
        <span className="text-sm text-blue-300">
          Environment variables needed
        </span>
        <span className="text-xs text-zinc-500">
          from <code className="text-blue-400/70">{envFile}</code>
        </span>
      </div>

      {/* Key/value inputs */}
      <div className="max-h-56 overflow-y-auto space-y-2 mb-3">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <label className="w-44 shrink-0 text-xs font-mono text-zinc-400 truncate" title={key}>
              {key}
            </label>
            <input
              type="text"
              value={values[key] ?? ""}
              onChange={(e) => handleChange(key, e.target.value)}
              placeholder="value"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 transition-colors"
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={handleSkip}
          disabled={acting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip
        </button>
        <button
          onClick={handleSubmit}
          disabled={acting || filledCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          <Send className="h-3.5 w-3.5" />
          Submit ({filledCount}/{keys.length})
        </button>
      </div>
    </div>
  );
}
