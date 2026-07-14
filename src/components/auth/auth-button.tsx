"use client";

import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";

export function AuthButton({ compact = false }: { compact?: boolean }) {
  const { ready, authenticated, login, logout } = usePrivy();

  if (!ready) {
    return (
      <button className="button button-secondary" type="button" disabled>
        <span className="loading-dot" aria-hidden="true" />
        <span className={compact ? "sr-only" : undefined}>Checking session</span>
      </button>
    );
  }

  if (authenticated) {
    if (compact) {
      return (
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void logout()}
        >
          <LogOut aria-hidden="true" size={17} />
          Sign out
        </button>
      );
    }

    return (
      <div className="header-actions">
        <Link className="button button-secondary" href="/dashboard">
          Dashboard
        </Link>
        <button
          className="icon-button"
          type="button"
          onClick={() => void logout()}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut aria-hidden="true" size={18} />
        </button>
      </div>
    );
  }

  return (
    <button className="button button-primary" type="button" onClick={login}>
      <LogIn aria-hidden="true" size={17} />
      Sign in
    </button>
  );
}
