import { useState, useEffect } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown, Check, Send, Monitor } from "lucide-react";
import type { AgentProviderId, AgentMode, ProjectRepository } from "../../types";
import { api } from "../../lib/api";

const MODES: { value: AgentMode; label: string }[] = [
  { value: "plan", label: "Plan" },
  { value: "implement", label: "Implement" },
  { value: "bugfix", label: "Bugfix" },
  { value: "review", label: "Review" },
];

const PROVIDERS: { value: AgentProviderId; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

function SelectField<T extends string>({
  value,
  onValueChange,
  items,
  placeholder,
}: {
  value: T;
  onValueChange: (v: T) => void;
  items: { value: T; label: string }[];
  placeholder: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors outline-none">
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl z-50">
          <Select.Viewport className="p-1">
            {items.map((item) => (
              <Select.Item
                key={item.value}
                value={item.value}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 outline-none cursor-pointer data-[highlighted]:bg-zinc-700"
              >
                <Select.ItemIndicator>
                  <Check className="h-3.5 w-3.5 text-lime-400" />
                </Select.ItemIndicator>
                <Select.ItemText>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function PromptPanel({
  onSubmit,
  disabled,
  projectId,
}: {
  onSubmit: (prompt: string, provider: AgentProviderId, mode: AgentMode, repositoryId?: number) => void;
  disabled?: boolean;
  projectId: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<AgentProviderId>("claude");
  const [mode, setMode] = useState<AgentMode>("plan");
  const [selectedRepoId, setSelectedRepoId] = useState<string>("auto");
  const [repos, setRepos] = useState<ProjectRepository[]>([]);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<ProjectRepository[]>(`/projects/${projectId}/repositories`)
      .then(setRepos)
      .catch(() => setRepos([]));
  }, [projectId]);

  function handleSubmit() {
    const text = prompt.trim();
    if (!text || disabled) return;
    const repoId = selectedRepoId !== "auto" ? Number(selectedRepoId) : undefined;
    onSubmit(text, provider, mode, repoId);
    setPrompt("");
  }

  const repoItems = [
    { value: "auto", label: "Auto-detect" },
    ...repos.map((r) => ({ value: r.repositoryId, label: r.repoFullName })),
  ];

  return (
    <div className="border-b border-zinc-800 px-6 py-6">
      <h2 className="text-xl font-semibold text-zinc-100 mb-1">
        What are we building today?
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Describe what you need and an AI agent will plan, implement, review, or
        fix it.
      </p>

      {/* Input area with bottom toolbar (matching mockup) */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden focus-within:border-lime-500/50 transition-colors">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a feature, bug, or task..."
          className="w-full resize-none bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit();
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-800/50">
          <div className="flex items-center gap-1.5">
            {/* Mode chips */}
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  mode === m.value
                    ? "bg-violet-500/15 text-violet-400 border border-violet-500/20"
                    : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
                }`}
              >
                {m.label}
              </button>
            ))}

            <div className="w-px h-4 bg-zinc-800 mx-1" />

            {/* Model selector */}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
              onClick={() =>
                setProvider(provider === "claude" ? "codex" : "claude")
              }
            >
              <Monitor className="h-3 w-3" />
              {PROVIDERS.find((p) => p.value === provider)?.label}
              <ChevronDown className="h-3 w-3" />
            </button>

            {repos.length > 0 && (
              <>
                <div className="w-px h-4 bg-zinc-800 mx-1" />
                <SelectField
                  value={selectedRepoId}
                  onValueChange={setSelectedRepoId}
                  items={repoItems}
                  placeholder="Repository"
                />
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!prompt.trim() || disabled}
            className="rounded-lg bg-lime-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-lime-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
