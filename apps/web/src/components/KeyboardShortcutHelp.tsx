import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";

const SHORTCUTS = [
  {
    group: "Navigation",
    items: [
      { label: "Command palette", keys: ["\u2318 K"] },
      { label: "Go to Command Center", keys: ["G", "C"] },
      { label: "Go to Board", keys: ["G", "B"] },
      { label: "Go to Agent Runs", keys: ["G", "R"] },
      { label: "Go to Code Search", keys: ["G", "S"] },
    ],
  },
  {
    group: "Actions",
    items: [
      { label: "Show this help", keys: ["?"] },
      { label: "Close panel/modal", keys: ["Esc"] },
    ],
  },
];

export function KeyboardShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleToggle() {
      setOpen((prev) => !prev);
    }
    window.addEventListener("toggle-shortcut-help", handleToggle);
    return () =>
      window.removeEventListener("toggle-shortcut-help", handleToggle);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[10vh] z-50 w-full max-w-lg -translate-x-1/2">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6">
            <Dialog.Title className="text-lg font-semibold text-zinc-100 mb-4">
              Keyboard Shortcuts
            </Dialog.Title>

            <div className="space-y-4">
              {SHORTCUTS.map((section) => (
                <div key={section.group}>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-2">
                    {section.group}
                  </p>
                  <div className="space-y-1.5">
                    {section.items.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-zinc-400">{item.label}</span>
                        <div className="flex gap-1">
                          {item.keys.map((key, i) => (
                            <kbd
                              key={i}
                              className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 font-mono"
                            >
                              {key}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
