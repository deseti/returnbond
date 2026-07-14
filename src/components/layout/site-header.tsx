import type { ReactNode } from "react";
import { Brand } from "@/components/layout/brand";

export function SiteHeader({ actions }: { actions: ReactNode }) {
  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <Brand />
        <nav aria-label="Account navigation">{actions}</nav>
      </div>
    </header>
  );
}

