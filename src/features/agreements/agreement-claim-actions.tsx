"use client";

import {
  CircleAlert,
  Gavel,
  Handshake,
  MessageSquareWarning,
  ShieldAlert,
  TimerReset,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { formatEther, parseEther } from "viem";
import { TransactionStatus } from "@/components/ui/transaction-status";
import {
  type ClaimAction,
  useAgreementClaimActions,
} from "@/features/agreements/use-agreement-claim-actions";
import { isSafeExternalUri, type OnchainAgreement } from "@/lib/web3/agreement";

const ACTION_CONFIG = {
  damage: {
    title: "Raise a damage claim",
    Icon: ShieldAlert,
  },
  overdue: {
    title: "Raise an overdue claim",
    Icon: TimerReset,
  },
  accept: {
    title: "Accept the owner claim",
    Icon: Handshake,
  },
  dispute: {
    title: "Dispute the owner claim",
    Icon: MessageSquareWarning,
  },
  finalize: {
    title: "Finalize unanswered claim",
    Icon: TimerReset,
  },
  resolve: {
    title: "Resolve the disputed claim",
    Icon: Gavel,
  },
} as const;

const ZERO = BigInt(0);
const MILLISECONDS_PER_SECOND = BigInt(1_000);

function ChainTime({ seconds }: { seconds: bigint }) {
  const milliseconds = seconds * MILLISECONDS_PER_SECOND;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return <span>{seconds.toString()} Unix seconds</span>;
  }
  const date = new Date(Number(milliseconds));
  if (Number.isNaN(date.getTime())) {
    return <span>{seconds.toString()} Unix seconds</span>;
  }
  return (
    <time
      dateTime={date.toISOString()}
      title={`${seconds.toString()} Unix seconds`}
      suppressHydrationWarning
    >
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(date)}
    </time>
  );
}

function exactMon(value: bigint): string {
  return `${formatEther(value)} MON (${value.toString()} wei)`;
}

function parseMonInput(value: string): bigint | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  try {
    return parseEther(normalized);
  } catch {
    return undefined;
  }
}

function PayoutPreview({
  ownerAward,
  borrowerRefund,
}: {
  ownerAward: bigint;
  borrowerRefund: bigint;
}) {
  return (
    <dl className="claim-payout-preview">
      <div>
        <dt>Owner receives</dt>
        <dd>{exactMon(ownerAward)}</dd>
      </div>
      <div>
        <dt>Borrower receives</dt>
        <dd>{exactMon(borrowerRefund)}</dd>
      </div>
    </dl>
  );
}

export function AgreementClaimActions({
  agreement,
  onAgreementChanged,
}: {
  agreement: OnchainAgreement;
  onAgreementChanged: () => Promise<void>;
}) {
  const lifecycle = useAgreementClaimActions({ agreement, onAgreementChanged });
  const [claimAmount, setClaimAmount] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [amountError, setAmountError] = useState<string>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [responseAction, setResponseAction] = useState<"accept" | "dispute">("accept");
  const primaryAction = lifecycle.availableActions[0];
  const action: ClaimAction | undefined = lifecycle.availableActions.includes("accept")
    ? responseAction
    : primaryAction;

  function validateClaimInputs(): { amount?: bigint; evidence?: string } {
    const amount = parseMonInput(claimAmount);
    const normalizedEvidence = evidenceUri.trim();
    const nextAmountError =
      amount === undefined
        ? "Enter a valid MON amount with no more than 18 decimal places."
        : amount <= ZERO || amount > agreement.depositAmount
          ? "The claim must be greater than zero and no more than the recorded deposit."
          : undefined;
    const nextEvidenceError = !normalizedEvidence
      ? "Enter a claim-evidence URI."
      : !isSafeExternalUri(normalizedEvidence)
        ? "Use a valid HTTPS, HTTP, or IPFS URI."
        : undefined;
    setAmountError(nextAmountError);
    setEvidenceError(nextEvidenceError);
    return nextAmountError || nextEvidenceError
      ? {}
      : { amount, evidence: normalizedEvidence };
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action !== "damage" && action !== "overdue") return;
    const validated = validateClaimInputs();
    if (validated.amount === undefined || !validated.evidence || !confirmed) return;
    await lifecycle.executeAction({
      action,
      amount: validated.amount,
      evidenceUri: validated.evidence,
    });
  }

  if (!action) {
    if (lifecycle.transactionAction && lifecycle.transaction.stage !== "idle") {
      const evidenceConfig = ACTION_CONFIG[lifecycle.transactionAction];
      return (
        <section className="lifecycle-action-panel" aria-labelledby="claim-transaction-title">
          <evidenceConfig.Icon aria-hidden="true" size={22} />
          <div>
            <p className="eyebrow">Transaction evidence</p>
            <h2 id="claim-transaction-title">{evidenceConfig.title}</h2>
            <p>The agreement no longer offers this action. Its real transaction record remains visible below.</p>
            <TransactionStatus state={lifecycle.transaction} />
          </div>
        </section>
      );
    }
    if (
      lifecycle.potentiallyAuthorized &&
      lifecycle.correctNetwork &&
      !lifecycle.signerSynchronized
    ) {
      return (
        <section className="lifecycle-action-panel" role="alert">
          <CircleAlert aria-hidden="true" size={21} />
          <div>
            <strong>Wallet synchronization required</strong>
            <p>The connected account and active Wagmi signer must match on Monad Testnet before a claim action can be offered.</p>
          </div>
        </section>
      );
    }
    if (
      lifecycle.potentiallyAuthorized &&
      lifecycle.correctNetwork &&
      lifecycle.needsChainTime &&
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

  const config = ACTION_CONFIG[action];
  const parsedResolutionAward = action === "resolve" ? parseMonInput(claimAmount) : undefined;
  const validResolutionAward =
    parsedResolutionAward !== undefined &&
    parsedResolutionAward >= ZERO &&
    parsedResolutionAward <= agreement.depositAmount;

  return (
    <section className="lifecycle-action-panel claim-action-panel" aria-labelledby="claim-action-title">
      <config.Icon aria-hidden="true" size={22} />
      <div>
        <p className="eyebrow">Available onchain action</p>
        <h2 id="claim-action-title">{config.title}</h2>

        {(action === "damage" || action === "overdue") && (
          <form className="return-proof-form" noValidate onSubmit={(event) => void submitClaim(event)}>
            <p>
              This claim and its evidence URI are the owner&apos;s assertions. ReturnBond does not independently verify the URI contents, physical damage, or overdue condition.
            </p>
            <p className="chain-deadline">
              {action === "damage" ? (
                <>The inspection window ends at <ChainTime seconds={lifecycle.inspectionDeadline} />. This claim must be confirmed in a block strictly before that time.</>
              ) : (
                <>The return deadline was reached at <ChainTime seconds={agreement.returnDeadline} /> according to Monad Testnet chain time.</>
              )}
            </p>
            <div className="form-field">
              <label htmlFor="claimAmount">Claim amount</label>
              <p id="claimAmount-help">More than 0 MON and no more than the {formatEther(agreement.depositAmount)} MON deposit.</p>
              <div className="input-suffix">
                <input
                  id="claimAmount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={claimAmount}
                  disabled={lifecycle.pending}
                  aria-describedby={`claimAmount-help${amountError ? " claimAmount-error" : ""}`}
                  aria-invalid={Boolean(amountError)}
                  onChange={(event) => {
                    setClaimAmount(event.target.value);
                    setConfirmed(false);
                    if (amountError) setAmountError(undefined);
                  }}
                />
                <span>MON</span>
              </div>
              {amountError && <span id="claimAmount-error" className="field-error" role="alert">{amountError}</span>}
            </div>
            <div className="form-field">
              <label htmlFor="claimEvidenceURI">Claim-evidence URI</label>
              <p id="claimEvidenceURI-help">Provide a real externally accessible HTTPS, HTTP, or IPFS URI.</p>
              <input
                id="claimEvidenceURI"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://… or ipfs://…"
                value={evidenceUri}
                disabled={lifecycle.pending}
                aria-describedby={`claimEvidenceURI-help${evidenceError ? " claimEvidenceURI-error" : ""}`}
                aria-invalid={Boolean(evidenceError)}
                onChange={(event) => {
                  setEvidenceUri(event.target.value);
                  setConfirmed(false);
                  if (evidenceError) setEvidenceError(undefined);
                }}
              />
              {evidenceError && <span id="claimEvidenceURI-error" className="field-error" role="alert">{evidenceError}</span>}
            </div>
            <label className="action-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={lifecycle.pending}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand that raising this claim is an irreversible onchain assertion and the borrower must accept or dispute it.
            </label>
            <button className="button button-primary lifecycle-submit" type="submit" disabled={lifecycle.pending || !confirmed}>
              {lifecycle.pending ? "Transaction in progress…" : "Raise claim"}
            </button>
          </form>
        )}

        {(action === "accept" || action === "dispute") && (
          <>
            <div className="claim-choice" aria-label="Claim response">
              <button
                className={`button ${action === "accept" ? "button-primary" : "button-secondary"}`}
                type="button"
                disabled={lifecycle.pending}
                onClick={() => {
                  setResponseAction("accept");
                  setConfirmed(false);
                }}
              >
                Accept claim
              </button>
              <button
                className={`button ${action === "dispute" ? "button-primary" : "button-secondary"}`}
                type="button"
                disabled={lifecycle.pending}
                onClick={() => {
                  setResponseAction("dispute");
                  setConfirmed(false);
                }}
              >
                Dispute claim
              </button>
            </div>
            <p className="chain-deadline">The response window ends at <ChainTime seconds={lifecycle.claimResponseDeadline} />. The response must be confirmed in a block strictly before that time.</p>
            {action === "accept" ? (
              <>
                <p>Acceptance permanently settles the owner&apos;s recorded claim and returns the exact remainder to the borrower.</p>
                <PayoutPreview ownerAward={agreement.claimAmount} borrowerRefund={lifecycle.borrowerRefund} />
                <label className="action-confirmation">
                  <input type="checkbox" checked={confirmed} disabled={lifecycle.pending} onChange={(event) => setConfirmed(event.target.checked)} />
                  I confirm this exact and irreversible claim payout.
                </label>
              </>
            ) : (
              <>
                <p>Disputing does not pay either participant now. It gives the recorded arbiter final control over the split of the full deposit.</p>
                <label className="action-confirmation action-confirmation-danger">
                  <input type="checkbox" checked={confirmed} disabled={lifecycle.pending} onChange={(event) => setConfirmed(event.target.checked)} />
                  I understand that arbitration will control the final and irreversible split.
                </label>
              </>
            )}
            <button
              className="button button-primary lifecycle-submit"
              type="button"
              disabled={lifecycle.pending || !confirmed}
              onClick={() => void lifecycle.executeAction({ action })}
            >
              {lifecycle.pending ? "Transaction in progress…" : action === "accept" ? "Accept and settle claim" : "Submit dispute"}
            </button>
          </>
        )}

        {action === "finalize" && (
          <>
            <p>The borrower&apos;s chain-timed response window ended without a response. Finalizing permanently pays the recorded claim and refunds the remainder.</p>
            <p className="chain-deadline">The response deadline was reached at <ChainTime seconds={lifecycle.claimResponseDeadline} />.</p>
            <PayoutPreview ownerAward={agreement.claimAmount} borrowerRefund={lifecycle.borrowerRefund} />
            <label className="action-confirmation">
              <input type="checkbox" checked={confirmed} disabled={lifecycle.pending} onChange={(event) => setConfirmed(event.target.checked)} />
              I confirm this exact and irreversible claim payout.
            </label>
            <button className="button button-primary lifecycle-submit" type="button" disabled={lifecycle.pending || !confirmed} onClick={() => void lifecycle.executeAction({ action: "finalize" })}>
              {lifecycle.pending ? "Transaction in progress…" : "Finalize and settle claim"}
            </button>
          </>
        )}

        {action === "resolve" && (
          <>
            <p>You are the recorded arbiter. Your award permanently determines the owner&apos;s share; the borrower receives the exact remainder of the original deposit.</p>
            <div className="form-field claim-resolution-field">
              <label htmlFor="ownerAward">Owner award</label>
              <p id="ownerAward-help">From 0 MON through the full {formatEther(agreement.depositAmount)} MON deposit.</p>
              <div className="input-suffix">
                <input
                  id="ownerAward"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={claimAmount}
                  disabled={lifecycle.pending}
                  aria-describedby="ownerAward-help"
                  aria-invalid={claimAmount.trim().length > 0 && !validResolutionAward}
                  onChange={(event) => {
                    setClaimAmount(event.target.value);
                    setConfirmed(false);
                  }}
                />
                <span>MON</span>
              </div>
              {claimAmount.trim().length > 0 && !validResolutionAward && <span className="field-error" role="alert">Enter an amount from zero through the full deposit, with no more than 18 decimals.</span>}
            </div>
            {validResolutionAward && (
              <PayoutPreview ownerAward={parsedResolutionAward} borrowerRefund={agreement.depositAmount - parsedResolutionAward} />
            )}
            <label className="action-confirmation action-confirmation-danger">
              <input type="checkbox" checked={confirmed} disabled={lifecycle.pending || !validResolutionAward} onChange={(event) => setConfirmed(event.target.checked)} />
              I confirm this final, irreversible owner award and borrower refund.
            </label>
            <button
              className="button button-primary lifecycle-submit"
              type="button"
              disabled={lifecycle.pending || !confirmed || !validResolutionAward}
              onClick={() => void lifecycle.executeAction({ action: "resolve", amount: parsedResolutionAward })}
            >
              {lifecycle.pending ? "Transaction in progress…" : "Resolve and distribute deposit"}
            </button>
          </>
        )}

        <TransactionStatus state={lifecycle.transaction} />
      </div>
    </section>
  );
}
