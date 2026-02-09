import { NavLink } from "react-router-dom";
import { Terminal, LayoutDashboard, Play } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

const NAV_ITEMS = [
  { to: "/command-center", label: "Command Center", icon: Terminal },
  { to: "/board", label: "Board", icon: LayoutDashboard },
  { to: "/runs", label: "Agent Runs", icon: Play },
] as const;

export function Sidebar() {
  const auth = useAuth();

  const tenantName =
    auth.status === "authenticated" ? auth.tenant.name : "...";
  const projectName =
    auth.status === "authenticated"
      ? (auth.projects.find((p) => p.id === auth.currentProjectId)?.name ??
        "No project")
      : "...";

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

      <div className="border-t border-zinc-800 px-4 py-3">
        <p className="text-xs text-zinc-500">
          {tenantName} / {projectName}
        </p>
      </div>
    </aside>
  );
}
