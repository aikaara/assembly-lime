import { useState, useEffect } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown, Check, Send, GitBranch } from "lucide-react";
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
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
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

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe a feature, bug, or task..."
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none outline-none focus:border-emerald-600 transition-colors"
        rows={4}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleSubmit();
          }
        }}
      />

      {/* Quick mode chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === m.value
                ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div className="mt-4 flex items-center gap-3">
        <SelectField
          value={provider}
          onValueChange={setProvider}
          items={PROVIDERS}
          placeholder="Provider"
        />

        {repos.length > 0 && (
          <SelectField
            value={selectedRepoId}
            onValueChange={setSelectedRepoId}
            items={repoItems}
            placeholder="Repository"
          />
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!prompt.trim() || disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="h-4 w-4" />
          Run Agent
        </button>
      </div>
    </div>
  );
}
