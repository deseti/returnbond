"use client";

import { ArrowUpRight, CircleAlert, FolderOpen, RefreshCw } from "lucide-react";
import Link from "next/link";
import { formatEther } from "viem";
import { monadTestnet } from "@/config/monad-testnet";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";
import {
  getAgreementStatusLabel,
  getSafeMetadataLink,
  type OnchainAgreement,
} from "@/lib/web3/agreement";
import { useAgreementDiscovery } from "@/features/agreements/use-agreement-discovery";

function Deadline({ agreement }: { agreement: OnchainAgreement }) {
  const deadline =
    agreement.status <= 1 ? agreement.handoverDeadline : agreement.returnDeadline;
  const milliseconds = deadline * BigInt(1_000);
  const label = agreement.status <= 1 ? "Handover deadline" : "Return deadline";
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return <span>{label}: {deadline.toString()} Unix seconds</span>;
  }
  return (
    <span>
      {label}: {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(Number(milliseconds)))}
    </span>
  );
}

export function AgreementDiscovery() {
  const wallet = useCanonicalWallet();
  const correctNetwork = wallet.chainId === monadTestnet.id;
  const discovery = useAgreementDiscovery(
    wallet.address,
    Boolean(wallet.address) && correctNetwork,
  );

  if (!wallet.address) {
    return (
      <section className="agreement-discovery discovery-state" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <div>
          <p className="eyebrow">Wallet unavailable</p>
          <h2>Connect one active EVM wallet to discover agreements.</h2>
          <p>A valid Wagmi connection or active EVM wallet is required before live role reads begin.</p>
        </div>
      </section>
    );
  }

  if (!correctNetwork) {
    return (
      <section className="agreement-discovery discovery-state" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <div>
          <p className="eyebrow">Wrong network</p>
          <h2>Switch to Monad Testnet to load your agreements.</h2>
          <p>Role-based discovery is available on chain ID 10143.</p>
        </div>
      </section>
    );
  }

  if (discovery.isPending) {
    return (
      <section className="agreement-discovery discovery-state" aria-busy="true">
        <span className="loading-mark" aria-hidden="true" />
        <div><p className="eyebrow">Live contract reads</p><h2>Finding your agreements…</h2></div>
      </section>
    );
  }

  if (discovery.isError) {
    return (
      <section className="agreement-discovery discovery-state" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <div>
          <p className="eyebrow">RPC failure</p>
          <h2>Your agreement lists could not be read.</h2>
          <p>Monad Testnet or the configured RPC may be temporarily unavailable. No static data was substituted.</p>
          <button className="text-button" type="button" onClick={() => void discovery.refetch()}>
            <RefreshCw aria-hidden="true" size={15} /> Retry discovery
          </button>
        </div>
      </section>
    );
  }

  if (discovery.data.length === 0) {
    return (
      <section className="agreement-discovery discovery-state">
        <FolderOpen aria-hidden="true" size={22} />
        <div>
          <p className="eyebrow">No agreements found</p>
          <h2>This wallet has no ReturnBond roles yet.</h2>
          <p>Create an agreement or ask an owner to use this address as borrower or arbiter.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agreement-discovery" aria-labelledby="agreements-title">
      <div className="discovery-heading">
        <div>
          <p className="eyebrow">Role-based discovery</p>
          <h2 id="agreements-title">Your agreements</h2>
          <p>Live records where this wallet is an owner, borrower, or arbiter.</p>
        </div>
        <StatusBadge tone="positive">{discovery.data.length.toString()} found</StatusBadge>
      </div>
      <div className="agreement-card-list">
        {discovery.data.map(({ agreement, roles }) => {
          const metadataLink = getSafeMetadataLink(agreement.itemMetadataURI);
          return (
            <article className="agreement-card" key={agreement.id.toString()}>
              <div className="agreement-card-topline">
                <span>Agreement #{agreement.id.toString()}</span>
                <StatusBadge tone={agreement.status >= 6 ? "warning" : "positive"}>
                  {getAgreementStatusLabel(agreement.status)}
                </StatusBadge>
              </div>
              <h3>{agreement.itemName}</h3>
              <dl>
                <div><dt>Deposit</dt><dd>{formatEther(agreement.depositAmount)} MON</dd></div>
                <div><dt>Your role</dt><dd>{roles.join(" · ")}</dd></div>
              </dl>
              <p className="agreement-card-deadline"><Deadline agreement={agreement} /></p>
              <div className="agreement-card-links">
                {metadataLink && (
                  <a href={metadataLink} target="_blank" rel="noreferrer">Item metadata <ArrowUpRight aria-hidden="true" size={14} /></a>
                )}
                <Link href={`/agreements/${agreement.id.toString()}`}>Open live agreement <ArrowUpRight aria-hidden="true" size={14} /></Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
