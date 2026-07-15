"use client";

import { useActiveWallet, usePrivy } from "@privy-io/react-auth";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { getAddress, type Address } from "viem";
import { useBalance, useBytecode, useConnection } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";
import { StatusBadge } from "@/components/ui/status-badge";
import { AgreementDiscovery } from "@/features/agreements/agreement-discovery";
import { returnBondContract } from "@/lib/web3/contract";
import { formatAddress, formatMonBalance } from "@/lib/web3/format";

type ConnectionState =
  | "loading"
  | "connected"
  | "rpc-error"
  | "missing-wallet"
  | "wrong-network"
  | "contract-unavailable";

function stateLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "rpc-error":
      return "RPC error";
    case "missing-wallet":
      return "Missing wallet";
    case "wrong-network":
      return "Network unavailable";
    case "contract-unavailable":
      return "Contract unavailable";
    default:
      return "Loading live state";
  }
}

function stateTone(
  state: ConnectionState,
): "neutral" | "positive" | "warning" | "negative" {
  if (state === "connected") return "positive";
  if (state === "loading") return "neutral";
  if (state === "rpc-error" || state === "contract-unavailable") {
    return "negative";
  }
  return "warning";
}

function formatWalletMetadataLabel(value: string): string {
  const label = value.trim().replaceAll("_", " ");
  if (!label) return "Connected EVM wallet";

  const normalizedLabel = label.replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
  return /wallet$/i.test(normalizedLabel)
    ? normalizedLabel
    : `${normalizedLabel} wallet`;
}

async function copyAddress(
  address: string,
  label: "Wallet" | "Contract",
): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }

    await navigator.clipboard.writeText(address);
    toast.success(`${label} address copied`);
  } catch {
    toast.error(
      `Could not copy ${label.toLowerCase()} address. Check clipboard permissions.`,
    );
  }
}

export function WalletDashboard() {
  const { authenticated } = usePrivy();
  const connection = useConnection();
  const { wallet: activeWallet } = useActiveWallet();

  const walletAddress =
    connection.address ??
    (activeWallet?.type === "ethereum"
      ? (getAddress(activeWallet.address) as Address)
      : undefined);
  const activeChainId =
    connection.chainId ??
    (activeWallet?.type === "ethereum"
      ? Number(activeWallet.chainId.replace("eip155:", ""))
      : undefined);
  const isCorrectNetwork = activeChainId === monadTestnet.id;

  const balance = useBalance({
    address: walletAddress,
    chainId: monadTestnet.id,
    query: {
      enabled: authenticated && Boolean(walletAddress) && isCorrectNetwork,
    },
  });
  const contractCode = useBytecode({
    address: returnBondContract.address,
    chainId: monadTestnet.id,
    query: {
      enabled: authenticated,
    },
  });

  const contractAvailable =
    contractCode.isSuccess &&
    Boolean(contractCode.data && contractCode.data !== "0x");
  const activeWalletType =
    activeWallet?.type === "ethereum"
      ? activeWallet.walletClientType === "privy"
        ? "Embedded wallet"
        : `${formatWalletMetadataLabel(activeWallet.meta.name)} · External`
      : undefined;
  const connectorWalletType = connection.connector
    ? formatWalletMetadataLabel(
        connection.connector.name || connection.connector.type,
      )
    : undefined;
  const walletType = activeWalletType ?? connectorWalletType;
  const walletExplorerUrl = walletAddress
    ? `${monadTestnet.blockExplorers.default.url}/address/${walletAddress}`
    : undefined;

  let state: ConnectionState = "loading";
  if (!walletAddress) {
    state = "missing-wallet";
  } else if (!isCorrectNetwork) {
    state = "wrong-network";
  } else if (balance.isError || contractCode.isError) {
    state = "rpc-error";
  } else if (balance.isPending || contractCode.isPending) {
    state = "loading";
  } else if (!contractAvailable) {
    state = "contract-unavailable";
  } else {
    state = "connected";
  }

  const refreshLiveState = () => {
    void balance.refetch();
    void contractCode.refetch();
  };

  return (
    <div className="dashboard-content">
    <div className="dashboard-grid">
      <section className="wallet-panel" aria-labelledby="wallet-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live wallet state</p>
            <h1 id="wallet-title">Your lending wallet</h1>
          </div>
          <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
        </div>

        <div className="wallet-address-block">
          <WalletCards aria-hidden="true" size={22} />
          <div className="address-content">
            <span className="field-label">Active EVM address</span>
            <span className="wallet-address" title={walletAddress}>
              {walletAddress ? formatAddress(walletAddress) : "No wallet available"}
            </span>
          </div>
          {walletAddress && walletExplorerUrl && (
            <div className="address-actions" aria-label="Wallet address actions">
              <button
                className="address-action-button"
                type="button"
                onClick={() => void copyAddress(walletAddress, "Wallet")}
                aria-label="Copy full active wallet address"
                title="Copy wallet address"
              >
                <Copy aria-hidden="true" size={16} />
              </button>
              <a
                className="address-action-button"
                href={walletExplorerUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View active wallet address on MonadVision"
                title="View wallet on MonadVision"
              >
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
            </div>
          )}
        </div>

        <dl className="live-read-grid">
          <div>
            <dt>Wallet type</dt>
            <dd>{walletType ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{isCorrectNetwork ? monadTestnet.name : "Wrong or unavailable"}</dd>
          </div>
          <div>
            <dt>Native balance</dt>
            <dd>
              {balance.isSuccess
                ? `${formatMonBalance(balance.data.value)} MON`
                : balance.isError
                  ? "RPC read failed"
                  : isCorrectNetwork && walletAddress
                    ? "Loading…"
                    : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>
              {contractCode.isError
                ? "RPC read failed"
                : contractCode.isPending
                  ? "Checking bytecode…"
                  : contractAvailable
                    ? "Available"
                    : "Not detected"}
            </dd>
          </div>
        </dl>

        {walletAddress && (
          <div className="dashboard-create-action">
            <div>
              <strong>Ready to lend an item?</strong>
              <p>Create the owner, borrower, arbiter, deposit, and deadline record onchain.</p>
            </div>
            <Link className="button button-primary" href="/create">
              <Plus aria-hidden="true" size={17} />
              Create agreement
            </Link>
          </div>
        )}

        {(state === "rpc-error" || state === "contract-unavailable") && (
          <div className="inline-alert" role="alert">
            <CircleAlert aria-hidden="true" size={19} />
            <p>
              Live Monad Testnet data could not be confirmed. Check the RPC
              configuration and try again.
            </p>
            <button className="text-button" type="button" onClick={refreshLiveState}>
              <RefreshCw aria-hidden="true" size={15} />
              Retry
            </button>
          </div>
        )}

        {state === "wrong-network" && (
          <div className="inline-alert" role="status">
            <CircleAlert aria-hidden="true" size={19} />
            <p>
              Select Monad Testnet in your active wallet to make live reads
              available.
            </p>
          </div>
        )}
      </section>

      <aside className="contract-slip" aria-labelledby="contract-title">
        <div className="slip-stamp" aria-hidden="true">
          <ShieldCheck size={25} />
        </div>
        <p className="eyebrow">Network record</p>
        <h2 id="contract-title">ReturnBond contract</h2>
        <div className="contract-address-row">
          <p className="contract-address" title={returnBondContract.address}>
            {formatAddress(returnBondContract.address)}
          </p>
          <button
            className="address-action-button"
            type="button"
            onClick={() =>
              void copyAddress(returnBondContract.address, "Contract")
            }
            aria-label="Copy full ReturnBond contract address"
            title="Copy contract address"
          >
            <Copy aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="slip-rule" />
        <div className="contract-check">
          {contractAvailable ? (
            <CircleCheck aria-hidden="true" size={18} />
          ) : (
            <CircleAlert aria-hidden="true" size={18} />
          )}
          <span>
            {contractCode.isPending
              ? "Checking deployed bytecode"
              : contractAvailable
                ? "Bytecode found on Monad Testnet"
                : "Deployed bytecode not confirmed"}
          </span>
        </div>

        <a
          className="contract-link"
          href={returnBondContract.explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          View verified contract
          <ArrowUpRight aria-hidden="true" size={16} />
        </a>
        <p className="slip-note">
          Discover every live agreement tied to your wallet and complete its
          role-authorized lifecycle—from deposit funding and handover through
          returns, refunds, claims, disputes, and arbiter resolution.
        </p>
      </aside>
    </div>
      <AgreementDiscovery />
    </div>
  );
}
