import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { LogOut, ChevronDown, ChevronRight, Search, Bell } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface BreadcrumbSegment {
  label: string;
  to?: string;
}

const ROUTE_MAP: Record<string, string> = {
  "command-center": "Command Center",
  board: "Board",
  runs: "Agent Runs",
  repos: "Repositories",
  connectors: "Connectors",
  clusters: "Clusters",
  sandboxes: "Sandboxes",
  domains: "Domains",
  "code-search": "Code Search",
  dependencies: "Dependencies",
};

function buildBreadcrumbs(pathname: string): BreadcrumbSegment[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const path = "/" + segments.slice(0, i + 1).join("/");

    if (ROUTE_MAP[seg]) {
      crumbs.push({ label: ROUTE_MAP[seg], to: path });
    } else if (seg === "dependencies" && i > 0) {
      crumbs.push({ label: "Dependencies", to: path });
    } else if (/^\d+$/.test(seg)) {
      // Numeric ID — show as detail
      const parent = segments[i - 1];
      if (parent === "runs") {
        crumbs.push({ label: `Run #${seg}` });
      } else if (parent === "repos") {
        crumbs.push({ label: `Repo #${seg}` });
      } else {
        crumbs.push({ label: `#${seg}` });
      }
    }
  }

  return crumbs;
}

export function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = buildBreadcrumbs(pathname);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const user = auth.status === "authenticated" ? auth.user : null;

  async function handleLogout() {
    await auth.logout();
    navigate("/login");
  }

  function openCommandPalette() {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 shrink-0">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
            )}
            {crumb.to && i < breadcrumbs.length - 1 ? (
              <button
                onClick={() => navigate(crumb.to!)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {crumb.label}
              </button>
            ) : (
              <span className="text-zinc-100 font-medium">{crumb.label}</span>
            )}
          </div>
        ))}
        {breadcrumbs.length === 0 && (
          <span className="text-zinc-100 font-medium">Assembly Lime</span>
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Search trigger */}
        <button
          onClick={openCommandPalette}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-400 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-mono ml-1">
            &#8984;K
          </kbd>
        </button>

        {/* Notification bell */}
        <button className="relative p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
          <Bell className="h-5 w-5" />
        </button>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-zinc-800"
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-7 w-7 rounded-full"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-xs font-medium text-zinc-300">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl z-50">
              <div className="px-3 py-2 border-b border-zinc-700">
                <p className="text-sm font-medium text-zinc-200">
                  {user?.name ?? user?.githubLogin}
                </p>
                <p className="text-xs text-zinc-500">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
