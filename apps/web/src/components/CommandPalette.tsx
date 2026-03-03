import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Terminal,
  LayoutDashboard,
  Play,
  GitBranch,
  Search,
  Zap,
  Plus,
  Clock,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

interface PaletteItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "navigation" | "actions" | "recent";
  action: () => void;
  shortcut?: string;
  meta?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const items: PaletteItem[] = [
    {
      id: "nav-cc",
      label: "Command Center",
      icon: Terminal,
      group: "navigation",
      action: () => navigate("/command-center"),
      shortcut: "G C",
    },
    {
      id: "nav-board",
      label: "Board",
      icon: LayoutDashboard,
      group: "navigation",
      action: () => navigate("/board"),
      shortcut: "G B",
    },
    {
      id: "nav-runs",
      label: "Agent Runs",
      icon: Play,
      group: "navigation",
      action: () => navigate("/runs"),
      shortcut: "G R",
    },
    {
      id: "nav-repos",
      label: "Repositories",
      icon: GitBranch,
      group: "navigation",
      action: () => navigate("/repos"),
    },
    {
      id: "nav-search",
      label: "Code Search",
      icon: Search,
      group: "navigation",
      action: () => navigate("/code-search"),
      shortcut: "G S",
    },
    {
      id: "act-run",
      label: "Run Agent...",
      icon: Zap,
      group: "actions",
      action: () => navigate("/command-center"),
    },
    {
      id: "act-ticket",
      label: "Create Ticket...",
      icon: Plus,
      group: "actions",
      action: () => navigate("/board"),
    },
  ];

  const filtered = query
    ? items.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()),
      )
    : items;

  const groups = [
    { key: "navigation" as const, label: "Navigation" },
    { key: "actions" as const, label: "Actions" },
    { key: "recent" as const, label: "Recent" },
  ];

  const flatFiltered = groups.flatMap((g) =>
    filtered.filter((item) => item.group === g.key),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      item.action();
      setOpen(false);
      setQuery("");
    },
    [],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < flatFiltered.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : flatFiltered.length - 1,
      );
    } else if (e.key === "Enter" && flatFiltered[selectedIndex]) {
      e.preventDefault();
      handleSelect(flatFiltered[selectedIndex]);
    }
  }

  // Listen for Cmd+K and the custom event from TopBar
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    function handleCustomOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", handleGlobalKey);
    window.addEventListener("open-command-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleGlobalKey);
      window.removeEventListener("open-command-palette", handleCustomOpen);
    };
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-50 w-full max-w-xl -translate-x-1/2"
          onKeyDown={handleKeyDown}
        >
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
              <Search className="h-5 w-5 text-zinc-500 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands, pages, tickets, repos..."
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
                autoFocus
              />
              <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 font-mono">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto py-2">
              {groups.map((group) => {
                const groupItems = filtered.filter(
                  (item) => item.group === group.key,
                );
                if (groupItems.length === 0) return null;

                return (
                  <div key={group.key}>
                    <div className="px-3 py-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium px-2">
                        {group.label}
                      </p>
                    </div>
                    <div className="px-2 space-y-0.5">
                      {groupItems.map((item) => {
                        const globalIdx = flatFiltered.indexOf(item);
                        const isSelected = globalIdx === selectedIndex;
                        const Icon = item.icon;

                        return (
                          <button
                            key={item.id}
                            onClick={() => handleSelect(item)}
                            onMouseEnter={() => setSelectedIndex(globalIdx)}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 w-full text-left transition-colors ${
                              isSelected
                                ? "bg-lime-500/10 text-lime-400"
                                : "text-zinc-300 hover:bg-zinc-800"
                            }`}
                          >
                            <Icon
                              className={`h-4 w-4 ${
                                item.group === "actions" && item.id === "act-run"
                                  ? "text-violet-400"
                                  : item.group === "actions"
                                    ? "text-lime-400"
                                    : ""
                              }`}
                            />
                            <span className="text-sm">{item.label}</span>
                            {item.shortcut && (
                              <span className="ml-auto text-[10px] text-zinc-600 font-mono">
                                {item.shortcut}
                              </span>
                            )}
                            {item.meta && (
                              <span className="ml-auto text-[10px] text-zinc-600">
                                {item.meta}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {flatFiltered.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-zinc-500">No results found</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Try a different search term
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-800 px-4 py-2 flex items-center gap-4 text-[10px] text-zinc-600">
              <span>
                <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">
                  &#8593;&#8595;
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">
                  &#8629;
                </kbd>{" "}
                select
              </span>
              <span>
                <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">
                  esc
                </kbd>{" "}
                close
              </span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
