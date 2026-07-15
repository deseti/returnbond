"use client";

import {
  BadgeCheck,
  CircleAlert,
  PackageOpen,
  TimerReset,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { TransactionStatus } from "@/components/ui/transaction-status";
import { useAgreementReturnActions } from "@/features/agreements/use-agreement-return-actions";
import { isSafeExternalUri, type OnchainAgreement } from "@/lib/web3/agreement";

const ACTION_CONFIG = {
  request: {
    title: "Request return confirmation",
    button: "Submit return request",
    Icon: PackageOpen,
  },
  confirm: {
    title: "Confirm successful return",
    button: "Confirm and refund deposit",
    Icon: BadgeCheck,
  },
  finalize: {
    title: "Finalize unanswered return",
    button: "Finalize full refund",
    Icon: TimerReset,
  },
} as const;

function InspectionDeadline({ seconds }: { seconds: bigint }) {
  const milliseconds = seconds * BigInt(1_000);
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return <span>{seconds.toString()} Unix seconds</span>;
  }
  const date = new Date(Number(milliseconds));
  if (Number.isNaN(date.getTime())) {
    return <span>{seconds.toString()} Unix seconds</span>;
  }
  return (
    <time dateTime={date.toISOString()} title={`${seconds.toString()} Unix seconds`}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(date)}
    </time>
  );
}

export function AgreementReturnActions({
  agreement,
  onAgreementChanged,
}: {
  agreement: OnchainAgreement;
  onAgreementChanged: () => Promise<void>;
}) {
  const lifecycle = useAgreementReturnActions({ agreement, onAgreementChanged });
  const [proofUri, setProofUri] = useState("");
  const [proofError, setProofError] = useState<string>();
  const [returnConfirmed, setReturnConfirmed] = useState(false);

  function validateProofUri(): string | undefined {
    const normalized = proofUri.trim();
    if (!normalized) return "Enter a return-proof URI.";
    if (!isSafeExternalUri(normalized)) {
      return "Use a valid HTTPS, HTTP, or IPFS URI.";
    }
    return undefined;
  }

  async function submitReturnRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateProofUri();
    setProofError(error);
    if (error) return;
    await lifecycle.executeAction("request", proofUri);
  }

  if (!lifecycle.action) {
    if (lifecycle.transactionAction && lifecycle.transaction.stage !== "idle") {
      const evidenceConfig = ACTION_CONFIG[lifecycle.transactionAction];
      return (
        <section className="lifecycle-action-panel" aria-labelledby="return-transaction-title">
          <evidenceConfig.Icon aria-hidden="true" size={22} />
          <div>
            <p className="eyebrow">Transaction evidence</p>
            <h2 id="return-transaction-title">{evidenceConfig.title}</h2>
            <p>The agreement no longer offers this action. Its transaction record remains visible below.</p>
            <TransactionStatus state={lifecycle.transaction} />
          </div>
        </section>
      );
    }
    if (lifecycle.potentiallyAuthorized && lifecycle.correctNetwork && !lifecycle.signerSynchronized) {
      return (
        <section className="lifecycle-action-panel" role="alert">
          <CircleAlert aria-hidden="true" size={21} />
          <div>
            <strong>Wallet synchronization required</strong>
            <p>The connected account and active Wagmi signer must match on Monad Testnet before a return action can be offered.</p>
          </div>
        </section>
      );
    }
    if (
      lifecycle.potentiallyAuthorized &&
      lifecycle.correctNetwork &&
      agreement.status === 3 &&
      (lifecycle.block.isPending || lifecycle.block.isError)
    ) {
      return (
        <section className="lifecycle-action-panel" role="alert">
          <CircleAlert aria-hidden="true" size={21} />
          <div>
            <strong>Chain time unavailable</strong>
            <p>The action cannot be offered until the latest Monad Testnet block timestamp is confirmed.</p>
          </div>
        </section>
      );
    }
    return null;
  }

  const config = ACTION_CONFIG[lifecycle.action];

  return (
    <section className="lifecycle-action-panel" aria-labelledby="return-action-title">
      <config.Icon aria-hidden="true" size={22} />
      <div>
        <p className="eyebrow">Available onchain action</p>
        <h2 id="return-action-title">{config.title}</h2>

        {lifecycle.action === "request" && (
          <form className="return-proof-form" noValidate onSubmit={(event) => void submitReturnRequest(event)}>
            <p>The proof URI is your offchain assertion stored onchain. The contract does not independently verify its contents or the physical return.</p>
            <div className="form-field">
              <label htmlFor="returnProofURI">Return-proof URI</label>
              <p id="returnProofURI-help">Provide a real externally accessible HTTPS, HTTP, or IPFS URI.</p>
              <input
                id="returnProofURI"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://… or ipfs://…"
                value={proofUri}
                disabled={lifecycle.pending}
                aria-describedby={`returnProofURI-help${proofError ? " returnProofURI-error" : ""}`}
                aria-invalid={Boolean(proofError)}
                onChange={(event) => {
                  setProofUri(event.target.value);
                  if (proofError) setProofError(undefined);
                }}
              />
              {proofError && <span id="returnProofURI-error" className="field-error" role="alert">{proofError}</span>}
            </div>
            <button className="button button-primary lifecycle-submit" type="submit" disabled={lifecycle.pending}>
              {lifecycle.pending ? "Transaction in progress…" : config.button}
            </button>
          </form>
        )}

        {lifecycle.action === "confirm" && (
          <>
            <p>Confirming records that the physical item was successfully returned and inspected, then returns the full recorded security deposit to the borrower.</p>
            <p className="chain-deadline">Inspection window ends at <InspectionDeadline seconds={lifecycle.inspectionDeadline} />. Eligibility is checked against the latest chain block time.</p>
            <label className="action-confirmation">
              <input
                type="checkbox"
                checked={returnConfirmed}
                disabled={lifecycle.pending}
                onChange={(event) => setReturnConfirmed(event.target.checked)}
              />
              I confirm that the physical item was successfully returned and inspected.
            </label>
            <button
              className="button button-primary lifecycle-submit"
              type="button"
              disabled={lifecycle.pending || !returnConfirmed}
              onClick={() => void lifecycle.executeAction("confirm")}
            >
              {lifecycle.pending ? "Transaction in progress…" : config.button}
            </button>
          </>
        )}

        {lifecycle.action === "finalize" && (
          <>
            <p>The owner&apos;s chain-timed inspection window expired without a response. This action returns the full recorded deposit to the borrower.</p>
            <p className="chain-deadline">Inspection window ended at <InspectionDeadline seconds={lifecycle.inspectionDeadline} />.</p>
            <button
              className="button button-primary lifecycle-submit"
              type="button"
              disabled={lifecycle.pending}
              onClick={() => void lifecycle.executeAction("finalize")}
            >
              {lifecycle.pending ? "Transaction in progress…" : config.button}
            </button>
          </>
        )}

        <TransactionStatus state={lifecycle.transaction} />
      </div>
    </section>
  );
}
