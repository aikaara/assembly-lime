const VARIANT_STYLES = {
  success: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  warning: "bg-amber-900/50 text-amber-400 border-amber-800",
  error: "bg-red-900/50 text-red-400 border-red-800",
  info: "bg-blue-900/50 text-blue-400 border-blue-800",
  neutral: "bg-zinc-800 text-zinc-400 border-zinc-700",
  purple: "bg-purple-900/50 text-purple-400 border-purple-800",
  cyan: "bg-cyan-900/50 text-cyan-400 border-cyan-800",
} as const;

type BadgeVariant = keyof typeof VARIANT_STYLES;

export function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${VARIANT_STYLES[variant]}`}
    >
      {children}
    </span>
  );
}
