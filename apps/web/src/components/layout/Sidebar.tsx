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
  Search,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useRecentRuns } from "../../hooks/useRecentRuns";

interface NavSection {
  label: string;
  items: {
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: () => number | null;
  }[];
}

export function Sidebar() {
  const auth = useAuth();
  const { recentRunIds } = useRecentRuns();
  const [collapsed, setCollapsed] = useState(false);
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

  const activeRunCount = recentRunIds.length;

  const sections: NavSection[] = [
    {
      label: "Workspace",
      items: [
        { to: "/command-center", label: "Command Center", icon: Terminal },
        { to: "/board", label: "Board", icon: LayoutDashboard },
        {
          to: "/runs",
          label: "Agent Runs",
          icon: Play,
          badge: () => (activeRunCount > 0 ? activeRunCount : null),
        },
      ],
    },
    {
      label: "Code",
      items: [
        { to: "/repos", label: "Repositories", icon: GitBranch },
        { to: "/repos/dependencies", label: "Dependencies", icon: Network },
        { to: "/code-search", label: "Code Search", icon: Search },
      ],
    },
    {
      label: "Infrastructure",
      items: [
        { to: "/connectors", label: "Connectors", icon: Plug },
        { to: "/clusters", label: "Clusters", icon: Server },
        { to: "/sandboxes", label: "Sandboxes", icon: Box },
        { to: "/domains", label: "Domains", icon: Globe },
      ],
    },
  ];

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
    <aside
      className={`flex h-full flex-col bg-zinc-900 border-r border-zinc-800 transition-all duration-200 shrink-0 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center gap-2.5 py-4 ${collapsed ? "justify-center px-0" : "px-4"}`}
      >
        <div className="h-8 w-8 rounded-lg bg-lime-500 flex items-center justify-center text-zinc-950 font-bold text-sm shrink-0">
          AL
        </div>
        {!collapsed && (
          <span className="text-base font-semibold text-zinc-100">
            Assembly Lime
          </span>
        )}
      </div>

      {/* Project Switcher */}
      {!collapsed && (
        <div className="border-b border-zinc-800 px-3 pb-3 relative" ref={menuRef}>
          <button
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <div className="h-5 w-5 rounded bg-violet-500/20 flex items-center justify-center text-[9px] font-bold text-violet-400 shrink-0">
              {currentProject?.name?.[0]?.toUpperCase() ?? "P"}
            </div>
            <span className="truncate text-xs">
              {tenantName} /{" "}
              <span className="text-zinc-100 font-medium">
                {currentProject?.name ?? "No project"}
              </span>
            </span>
            <ChevronsUpDown className="h-3 w-3 ml-auto text-zinc-600 shrink-0" />
          </button>

          {projectMenuOpen && projects.length > 1 && (
            <div className="absolute top-full left-0 right-0 mt-1 mx-0 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl z-50">
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
                      ? "text-lime-400"
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
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium px-3 mb-1">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, badge }) => {
                const badgeValue = badge?.();
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        collapsed ? "justify-center px-0" : ""
                      } ${
                        isActive
                          ? "bg-zinc-800 text-lime-400"
                          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                      }`
                    }
                    title={collapsed ? label : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{label}</span>
                        {badgeValue != null && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-lime-500/15 px-1.5 text-[10px] font-medium text-lime-400">
                            {badgeValue}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse button */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors w-full ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
