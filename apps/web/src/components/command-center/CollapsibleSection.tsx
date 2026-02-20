import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";

export function CollapsibleSection({
  label,
  badge,
  children,
  defaultOpen = false,
}: {
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 transition-colors">
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="font-medium">{label}</span>
        {badge}
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-slideDown data-[state=closed]:animate-slideUp">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
