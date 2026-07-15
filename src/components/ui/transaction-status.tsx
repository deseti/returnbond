"use client";

import { ArrowUpRight, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { Hash } from "viem";
import { getTransactionExplorerUrl } from "@/lib/web3/contract";

export type TransactionState =
  | { stage: "idle" | "simulating" | "estimating" | "awaiting-confirmation" }
  | { stage: "submitted" | "confirming" | "confirmed"; hash: Hash }
  | {
      stage: "rejected" | "reverted" | "simulation-error" | "rpc-error" | "verification-error";
      message: string;
      technical?: string;
      hash?: Hash;
    };

export function isTransactionPending(state: TransactionState): boolean {
  return ["simulating", "estimating", "awaiting-confirmation", "submitted", "confirming"].includes(state.stage);
}

export function TransactionStatus({ state }: { state: TransactionState }) {
  if (state.stage === "idle") return null;
  const pending = isTransactionPending(state);
  const failed = ["rejected", "reverted", "simulation-error", "rpc-error", "verification-error"].includes(state.stage);
  const labels: Record<Exclude<TransactionState["stage"], "idle">, string> = {
    simulating: "Simulating contract call",
    estimating: "Estimating transaction gas",
    "awaiting-confirmation": "Awaiting wallet confirmation",
    submitted: "Transaction submitted",
    confirming: "Waiting for onchain confirmation",
    confirmed: "Live contract state confirmed",
    rejected: "Transaction rejected",
    reverted: "Transaction reverted",
    "simulation-error": "Contract simulation failed",
    "rpc-error": "RPC request failed",
    "verification-error": "State verification failed",
  };
  const hash = "hash" in state ? state.hash : undefined;

  return (
    <section className={`transaction-status ${failed ? "transaction-status-error" : ""}`} aria-live="polite" aria-busy={pending}>
      {pending ? <LoaderCircle className="spin" aria-hidden="true" size={20} /> : failed ? <CircleAlert aria-hidden="true" size={20} /> : <CircleCheck aria-hidden="true" size={20} />}
      <div>
        <strong>{labels[state.stage]}</strong>
        {"message" in state && <p>{state.message}</p>}
        {"technical" in state && state.technical && <details><summary>Technical details</summary><p className="technical-error">{state.technical}</p></details>}
        {hash && (
          <a className="transaction-link" href={getTransactionExplorerUrl(hash)} target="_blank" rel="noreferrer">
            View transaction {hash.slice(0, 10)}…{hash.slice(-6)} <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </div>
    </section>
  );
}
