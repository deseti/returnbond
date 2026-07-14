"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Copy,
  RefreshCw,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { formatEther } from "viem";
import { useConnection, useReadContract, useSwitchChain } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getAgreementStatusLabel,
  getSafeMetadataLink,
  normalizeAgreement,
  type OnchainAgreement,
} from "@/lib/web3/agreement";
import {
  getAddressExplorerUrl,
  returnBondContract,
} from "@/lib/web3/contract";
import { formatAddress } from "@/lib/web3/format";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const UINT256_MAX = BigInt(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935",
);

function parseAgreementId(value: string): bigint | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  try {
    const id = BigInt(value);
    return id <= UINT256_MAX ? id : undefined;
  } catch {
    return undefined;
  }
}

function formatDeposit(value: bigint): string {
  return `${formatEther(value)} MON`;
}

function formatPeriod(seconds: bigint): string {
  const units = [
    [BigInt(86_400), "day"],
    [BigInt(3_600), "hour"],
    [BigInt(60), "minute"],
  ] as const;
  for (const [size, label] of units) {
    if (seconds % size === ZERO) {
      const amount = seconds / size;
      return `${amount.toString()} ${label}${amount === ONE ? "" : "s"} (${seconds.toString()} seconds)`;
    }
  }
  return `${seconds.toString()} seconds`;
}

function OnchainTime({ seconds }: { seconds: bigint }) {
  const milliseconds = seconds * BigInt(1_000);
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

async function copyValue(value: string, label: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}

function wasShareCancelled(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || /share (?:was )?cancel(?:led|ed)/i.test(message);
}

async function copyAgreementUrl(url: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(url);
    toast.success("Agreement link copied");
    return true;
  } catch {
    return false;
  }
}

async function shareAgreement(
  agreement: OnchainAgreement,
  status: string,
): Promise<void> {
  const url = new URL(
    `/agreements/${agreement.id.toString()}`,
    window.location.origin,
  ).href;

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: `ReturnBond agreement #${agreement.id.toString()}`,
        text: `${agreement.itemName} has the onchain status ${status}.`,
        url,
      });
      return;
    } catch (error) {
      if (wasShareCancelled(error)) return;
    }
  }

  if (await copyAgreementUrl(url)) return;
  toast.error("Could not share or copy the agreement link.");
}

function RoleRow({ label, address }: { label: string; address: `0x${string}` }) {
  return (
    <div className="role-row">
      <dt>{label}</dt>
      <dd>
        <span title={address}>{formatAddress(address)}</span>
        <div className="address-actions" aria-label={`${label} address actions`}>
          <button
            className="address-action-button"
            type="button"
            onClick={() => void copyValue(address, `${label} address`)}
            aria-label={`Copy ${label.toLowerCase()} address`}
          >
            <Copy aria-hidden="true" size={15} />
          </button>
          <a
            className="address-action-button"
            href={getAddressExplorerUrl(address)}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${label.toLowerCase()} on MonadVision`}
          >
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </div>
      </dd>
    </div>
  );
}

function AgreementRecord({ agreement }: { agreement: OnchainAgreement }) {
  const metadataLink = getSafeMetadataLink(agreement.itemMetadataURI);
  const status = getAgreementStatusLabel(agreement.status);
  const statusTone = agreement.status === 0 ? "neutral" : agreement.status >= 6 ? "warning" : "positive";

  return (
    <div className="agreement-detail-layout">
      <article className="agreement-record" aria-labelledby="agreement-title">
        <div className="agreement-record-heading">
          <div>
            <p className="eyebrow">Live onchain agreement #{agreement.id.toString()}</p>
            <h1 id="agreement-title">{agreement.itemName}</h1>
          </div>
          <div className="agreement-heading-actions">
            <StatusBadge tone={statusTone}>{status}</StatusBadge>
            <button
              className="button button-primary agreement-share-action"
              type="button"
              onClick={() => void shareAgreement(agreement, status)}
              aria-label={`Share ReturnBond agreement #${agreement.id.toString()}`}
            >
              <Share2 aria-hidden="true" size={17} />
              Share agreement
            </button>
          </div>
        </div>

        <dl className="agreement-data-list">
          <div>
            <dt>Agreement ID</dt>
            <dd>{agreement.id.toString()}</dd>
          </div>
          <div>
            <dt>Security deposit</dt>
            <dd>{formatDeposit(agreement.depositAmount)}</dd>
          </div>
          <div className="data-wide">
            <dt>Item metadata URI</dt>
            <dd className="breakable-value">
              {metadataLink ? (
                <a href={metadataLink} target="_blank" rel="noreferrer">
                  {agreement.itemMetadataURI}
                  <ArrowUpRight aria-hidden="true" size={15} />
                </a>
              ) : (
                <span title="The onchain value is not a safe HTTP, HTTPS, or IPFS link">
                  {agreement.itemMetadataURI}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Handover deadline</dt>
            <dd><OnchainTime seconds={agreement.handoverDeadline} /></dd>
          </div>
          <div>
            <dt>Return deadline</dt>
            <dd><OnchainTime seconds={agreement.returnDeadline} /></dd>
          </div>
          <div>
            <dt>Inspection period</dt>
            <dd>{formatPeriod(agreement.inspectionPeriod)}</dd>
          </div>
          <div>
            <dt>Claim response period</dt>
            <dd>{formatPeriod(agreement.claimResponsePeriod)}</dd>
          </div>
        </dl>
      </article>

      <aside className="roles-slip" aria-labelledby="roles-title">
        <p className="eyebrow">Agreement roles</p>
        <h2 id="roles-title">People on record</h2>
        <dl>
          <RoleRow label="Owner" address={agreement.owner} />
          <RoleRow label="Borrower" address={agreement.borrower} />
          <RoleRow label="Arbiter" address={agreement.arbiter} />
        </dl>
        <p className="receipt-note">This Phase 2 page is read-only. It contains no funding or lifecycle actions.</p>
      </aside>
    </div>
  );
}

export function AgreementDetail({ agreementId: rawAgreementId }: { agreementId: string }) {
  const agreementId = parseAgreementId(rawAgreementId);
  const connection = useConnection();
  const switchChain = useSwitchChain();
  const wrongNetwork = Boolean(
    connection.address && connection.chainId !== monadTestnet.id,
  );
  const agreementQuery = useReadContract({
    address: returnBondContract.address,
    abi: returnBondContract.abi,
    functionName: "getAgreement",
    args: agreementId ? [agreementId] : undefined,
    chainId: monadTestnet.id,
    query: {
      enabled: agreementId !== undefined && !wrongNetwork,
      retry: false,
    },
  });

  if (agreementId === undefined) {
    return (
      <main className="detail-main site-shell">
        <section className="state-sheet" role="alert">
          <CircleAlert aria-hidden="true" size={28} />
          <p className="eyebrow">Invalid agreement ID</p>
          <h1>Use a positive whole-number agreement ID.</h1>
          <Link className="text-link" href="/dashboard"><ArrowLeft aria-hidden="true" size={16} />Back to dashboard</Link>
        </section>
      </main>
    );
  }

  if (wrongNetwork) {
    return (
      <main className="detail-main site-shell">
        <section className="state-sheet" role="alert">
          <CircleAlert aria-hidden="true" size={28} />
          <p className="eyebrow">Wrong network</p>
          <h1>Switch to Monad Testnet to load this live agreement.</h1>
          <p>Your connected wallet is not currently on chain ID 10143.</p>
          <button
            className="button button-primary"
            type="button"
            disabled={switchChain.isPending}
            onClick={() => void switchChain.switchChainAsync({ chainId: monadTestnet.id })}
          >
            {switchChain.isPending ? "Switching…" : "Switch to Monad Testnet"}
          </button>
        </section>
      </main>
    );
  }

  if (agreementQuery.isPending) {
    return (
      <main className="detail-main site-shell" aria-busy="true">
        <div className="auth-loading">
          <span className="loading-mark" aria-hidden="true" />
          <p>Reading agreement #{agreementId.toString()} from Monad Testnet…</p>
        </div>
      </main>
    );
  }

  if (agreementQuery.isError) {
    const notFound = agreementQuery.error.message.includes("AgreementNotFound");
    return (
      <main className="detail-main site-shell">
        <section className="state-sheet" role="alert">
          <CircleAlert aria-hidden="true" size={28} />
          <p className="eyebrow">{notFound ? "Agreement not found" : "RPC error"}</p>
          <h1>
            {notFound
              ? `Agreement #${agreementId.toString()} does not exist on the configured contract.`
              : "The live agreement could not be read."}
          </h1>
          {!notFound && <p>Monad Testnet or the configured RPC may be temporarily unavailable.</p>}
          <button className="text-button" type="button" onClick={() => void agreementQuery.refetch()}>
            <RefreshCw aria-hidden="true" size={15} />Retry live read
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="detail-main site-shell">
      <Link className="detail-back-link" href="/dashboard">
        <ArrowLeft aria-hidden="true" size={16} />Dashboard
      </Link>
      <AgreementRecord agreement={normalizeAgreement(agreementQuery.data)} />
    </main>
  );
}
