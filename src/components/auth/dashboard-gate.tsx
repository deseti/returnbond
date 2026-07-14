"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogIn, ShieldCheck } from "lucide-react";
import { WalletDashboard } from "@/features/wallet/wallet-dashboard";

export function DashboardGate() {
  const { ready, authenticated, login } = usePrivy();

  if (!ready) {
    return (
      <main className="dashboard-main site-shell" aria-busy="true">
        <div className="auth-loading">
          <span className="loading-mark" aria-hidden="true" />
          <p>Checking your ReturnBond session…</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="dashboard-main site-shell">
        <section className="signin-sheet" aria-labelledby="signin-title">
          <div className="signin-icon" aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">Dashboard access</p>
          <h1 id="signin-title">Your agreements start with your wallet.</h1>
          <p>
            Sign in with Google, X, or an external EVM wallet. Social sign-in
            creates an embedded wallet when you do not already have one.
          </p>
          <button className="button button-primary button-large" type="button" onClick={login}>
            <LogIn aria-hidden="true" size={18} />
            Sign in to ReturnBond
          </button>
          <small>No private key entry. No transaction is sent by signing in.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-main site-shell">
      <WalletDashboard />
    </main>
  );
}

