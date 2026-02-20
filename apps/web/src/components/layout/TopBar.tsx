import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { LogOut, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const PAGE_TITLES: Record<string, string> = {
  "/command-center": "Command Center",
  "/board": "Board",
  "/runs": "Agent Runs",
};

export function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const title =
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/command-center/")
      ? "Command Center"
      : pathname.startsWith("/runs/")
        ? "Run Details"
        : "Assembly Lime");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const user =
    auth.status === "authenticated" ? auth.user : null;

  async function handleLogout() {
    await auth.logout();
    navigate("/login");
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6">
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-zinc-800"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs text-zinc-300">
              {user?.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}
          <span className="text-sm text-zinc-300 hidden sm:inline">
            {user?.name ?? user?.githubLogin ?? "User"}
          </span>
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
    </header>
  );
}
