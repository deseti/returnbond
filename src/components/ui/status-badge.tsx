import type { ReactNode } from "react";

type StatusTone = "neutral" | "positive" | "warning" | "negative";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

