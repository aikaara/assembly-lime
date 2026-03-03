import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const pendingPrefix = useRef<string | null>(null);
  const prefixTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // ? for help
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-shortcut-help"));
        return;
      }

      // G + <key> navigation chords
      if (pendingPrefix.current === "g") {
        pendingPrefix.current = null;
        clearTimeout(prefixTimer.current);

        switch (e.key.toLowerCase()) {
          case "c":
            e.preventDefault();
            navigate("/command-center");
            return;
          case "b":
            e.preventDefault();
            navigate("/board");
            return;
          case "r":
            e.preventDefault();
            navigate("/runs");
            return;
          case "s":
            e.preventDefault();
            navigate("/code-search");
            return;
        }
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        pendingPrefix.current = "g";
        clearTimeout(prefixTimer.current);
        prefixTimer.current = setTimeout(() => {
          pendingPrefix.current = null;
        }, 500);
      }
    },
    [navigate],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(prefixTimer.current);
    };
  }, [handleKey]);
}
