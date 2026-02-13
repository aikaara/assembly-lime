import { NavLink } from "react-router-dom";
import {
  Terminal,
  LayoutDashboard,
  Play,
  ChevronsUpDown,
  GitBranch,
  Plug,
  Server,
  Box,
  Globe,
  Network,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";

const NAV_ITEMS = [
  { to: "/command-center", label: "Command Center", icon: Terminal },
  { to: "/board", label: "Board", icon: LayoutDashboard },
  { to: "/runs", label: "Agent Runs", icon: Play },
  { to: "/repos", label: "Repositories", icon: GitBranch },
  { to: "/repos/dependencies", label: "Dependencies", icon: Network },
  { to: "/connectors", label: "Connectors", icon: Plug },
  { to: "/clusters", label: "K8s Clusters", icon: Server },
  { to: "/sandboxes", label: "Sandboxes", icon: Box },
  { to: "/domains", label: "Domains", icon: Globe },
] as const;

export function Sidebar() {
  const auth = useAuth();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const tenantName =
    auth.status === "authenticated" ? auth.tenant.name : "...";
  const projects =
    auth.status === "authenticated" ? auth.projects : [];
  const currentProject =
    auth.status === "authenticated"
      ? projects.find((p) => p.id === auth.currentProjectId)
      : null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <aside className="flex h-full w-56 flex-col bg-zinc-900 border-r border-zinc-800">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
          AL
        </div>
        <span className="text-lg font-semibold text-zinc-100">
          Assembly Lime
        </span>
      </div>

      <nav className="flex-1 px-2 py-2 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-zinc-800 text-emerald-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-800 px-3 py-3 relative" ref={menuRef}>
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1 px-1">
          {tenantName}
        </p>
        <button
          onClick={() => setProjectMenuOpen(!projectMenuOpen)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          <span className="truncate">
            {currentProject?.name ?? "No project"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>

        {projectMenuOpen && projects.length > 1 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl z-50">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (auth.status === "authenticated") {
                    auth.setCurrentProjectId(p.id);
                  }
                  setProjectMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-700 ${
                  p.id === currentProject?.id
                    ? "text-emerald-400"
                    : "text-zinc-300"
                }`}
              >
                <span className="font-mono text-xs text-zinc-500">
                  {p.key}
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
