"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, HandCoins, PackageCheck, RotateCcw } from "lucide-react";
import { useState } from "react";
import { formatEther, type Hash } from "viem";
import { useBalance, useBlock, usePublicClient } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";
import {
  isTransactionPending,
  TransactionStatus,
  type TransactionState,
} from "@/components/ui/transaction-status";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";
import type { OnchainAgreement } from "@/lib/web3/agreement";
import { agreementQueryKeys } from "@/lib/web3/agreement-queries";
import { returnBondContract } from "@/lib/web3/contract";
import { explainContractError, isRpcError, isUserRejectedError } from "@/lib/web3/errors";

type LifecycleAction = "fund" | "handover" | "refund";

const ACTION_CONFIG = {
  fund: {
    title: "Fund the security deposit",
    button: "Fund agreement",
    description: "The exact deposit is sent to the ReturnBond contract, not directly to the owner.",
    expectedAfter: 1,
    Icon: HandCoins,
  },
  handover: {
    title: "Confirm physical handover",
    button: "Confirm handover",
    description: "Record your offchain assertion that the physical item has actually been handed to the borrower.",
    expectedAfter: 2,
    Icon: PackageCheck,
  },
  refund: {
    title: "Cancel failed handover",
    button: "Return full deposit",
    description: "Cancel the uncompleted handover and return the full recorded deposit to the borrower.",
    expectedAfter: 8,
    Icon: RotateCcw,
  },
} as const;

export function AgreementLifecycleActions({
  agreement,
  onAgreementChanged,
}: {
  agreement: OnchainAgreement;
  onAgreementChanged: () => Promise<void>;
}) {
  const wallet = useCanonicalWallet();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const queryClient = useQueryClient();
  const block = useBlock({
    chainId: monadTestnet.id,
    watch: true,
    query: { enabled: wallet.chainId === monadTestnet.id },
  });
  const balance = useBalance({
    address: wallet.address,
    chainId: monadTestnet.id,
    query: { enabled: Boolean(wallet.address) && wallet.chainId === monadTestnet.id },
  });
  const [transaction, setTransaction] = useState<TransactionState>({ stage: "idle" });
  const [transactionAction, setTransactionAction] =
    useState<LifecycleAction>();
  const [handoverConfirmed, setHandoverConfirmed] = useState(false);

  const correctNetwork = wallet.chainId === monadTestnet.id;
  const beforeDeadline = block.data ? block.data.timestamp < agreement.handoverDeadline : false;
  const isBorrower =
    wallet.address?.toLowerCase() === agreement.borrower.toLowerCase();
  const isOwner = wallet.address?.toLowerCase() === agreement.owner.toLowerCase();
  let action: LifecycleAction | undefined;
  if (correctNetwork && block.data && agreement.status === 0 && isBorrower && beforeDeadline) action = "fund";
  if (correctNetwork && block.data && agreement.status === 1 && isOwner && beforeDeadline) action = "handover";
  if (correctNetwork && block.data && agreement.status === 1 && isBorrower && !beforeDeadline) action = "refund";

  const potentiallyAuthorized =
    (agreement.status === 0 && isBorrower) ||
    (agreement.status === 1 && (isOwner || isBorrower));
  if (!action) {
    if (transactionAction && transaction.stage !== "idle") {
      const evidenceConfig = ACTION_CONFIG[transactionAction];
      return (
        <section
          className="lifecycle-action-panel"
          aria-labelledby="lifecycle-transaction-title"
        >
          <evidenceConfig.Icon aria-hidden="true" size={22} />
          <div>
            <p className="eyebrow">Transaction evidence</p>
            <h2 id="lifecycle-transaction-title">{evidenceConfig.title}</h2>
            <p>
              The agreement no longer offers this action. Its transaction
              record remains visible below.
            </p>
            <TransactionStatus state={transaction} />
          </div>
        </section>
      );
    }
    if (potentiallyAuthorized && correctNetwork && (block.isPending || block.isError)) {
      return (
        <section className="lifecycle-action-panel" role="alert">
          <CircleAlert aria-hidden="true" size={21} />
          <div><strong>Chain time unavailable</strong><p>The action cannot be offered until the latest Monad Testnet block timestamp is confirmed.</p></div>
        </section>
      );
    }
    return null;
  }

  const config = ACTION_CONFIG[action];
  const pending = isTransactionPending(transaction);
  const disabled = pending || (action === "handover" && !handoverConfirmed);

  async function executeAction() {
    if (!action || pending) return;
    setTransactionAction(action);
    setTransaction({ stage: "estimating" });

    if (!publicClient || !wallet.writeAddress || !wallet.walletClient) {
      const message = wallet.signerMismatch
        ? "The connected account and signing wallet are out of sync. Reconnect before submitting."
        : "An active wallet-client signer and Monad Testnet RPC client are required.";
      setTransaction({ stage: "rpc-error", message });
      return;
    }
    const walletClient = wallet.walletClient;
    const writeAddress = wallet.writeAddress;
    if (wallet.chainId !== monadTestnet.id || wallet.walletClient.chain?.id !== monadTestnet.id) {
      setTransaction({ stage: "rpc-error", message: "Switch the active signing wallet to Monad Testnet before submitting." });
      return;
    }
    if (action === "handover" && !handoverConfirmed) return;

    let submitTransaction: (() => Promise<Hash>) | undefined;
    try {
      if (action === "fund") {
        const simulation = await publicClient.simulateContract({
            account: writeAddress,
            address: returnBondContract.address,
            abi: returnBondContract.abi,
            functionName: "fundAgreement",
            args: [agreement.id],
            value: agreement.depositAmount,
          });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (action === "handover") {
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          address: returnBondContract.address,
          abi: returnBondContract.abi,
          functionName: "confirmHandover",
          args: [agreement.id],
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else {
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          address: returnBondContract.address,
          abi: returnBondContract.abi,
          functionName: "refundUnhandedAgreement",
          args: [agreement.id],
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      }

      if (action === "fund") {
        const [gas, gasPrice, liveBalance] = await Promise.all([
          publicClient.estimateContractGas({
            account: writeAddress,
            address: returnBondContract.address,
            abi: returnBondContract.abi,
            functionName: "fundAgreement",
            args: [agreement.id],
            value: agreement.depositAmount,
          }),
          publicClient.getGasPrice(),
          publicClient.getBalance({ address: writeAddress }),
        ]);
        const required = agreement.depositAmount + gas * gasPrice;
        if (liveBalance < required) {
          setTransaction({
            stage: "simulation-error",
            message: `This wallet needs at least ${formatEther(required)} MON for the exact deposit and current estimated gas, but has ${formatEther(liveBalance)} MON.`,
          });
          return;
        }
      }
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isRpcError(error) ? "rpc-error" : "simulation-error",
        message: explained.message,
        technical: explained.technical,
      });
      return;
    }

    let hash: Hash;
    setTransaction({ stage: "awaiting-confirmation" });
    try {
      if (!submitTransaction) throw new Error("The simulated transaction request is unavailable.");
      hash = await submitTransaction();
      setTransaction({ stage: "submitted", hash });
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isUserRejectedError(error) ? "rejected" : "rpc-error",
        message: isUserRejectedError(error)
          ? "You rejected the wallet request. Nothing was submitted."
          : "The wallet or RPC could not submit the transaction.",
        technical: explained.technical,
      });
      return;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    setTransaction({ stage: "confirming", hash });
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setTransaction({ stage: "reverted", hash, message: "The confirmed receipt reports a reverted transaction." });
        return;
      }
      const liveAgreement = await publicClient.readContract({
        ...returnBondContract,
        functionName: "getAgreement",
        args: [agreement.id],
      });
      if (liveAgreement.status !== config.expectedAfter) {
        setTransaction({
          stage: "verification-error",
          hash,
          message: `The receipt succeeded, but live contract state did not change to the expected status. Current status value: ${liveAgreement.status.toString()}.`,
        });
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agreementQueryKeys.all }),
        balance.refetch(),
        onAgreementChanged(),
      ]);
      setTransaction({ stage: "confirmed", hash });
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isRpcError(error) ? "rpc-error" : "verification-error",
        hash,
        message: "The transaction was submitted, but its receipt and resulting live state could not be fully confirmed.",
        technical: explained.technical,
      });
    }
  }

  return (
    <section className="lifecycle-action-panel" aria-labelledby="lifecycle-action-title">
      <config.Icon aria-hidden="true" size={22} />
      <div>
        <p className="eyebrow">Available onchain action</p>
        <h2 id="lifecycle-action-title">{config.title}</h2>
        <p>{config.description}</p>
        {action === "fund" && (
          <p className="action-balance">Live wallet balance: {balance.isSuccess ? `${formatEther(balance.data.value)} MON` : balance.isError ? "RPC read failed" : "Loading…"}</p>
        )}
        {action === "handover" && (
          <label className="handover-confirmation">
            <input type="checkbox" checked={handoverConfirmed} disabled={pending} onChange={(event) => setHandoverConfirmed(event.target.checked)} />
            I confirm that I physically handed this item to the borrower.
          </label>
        )}
        <button className="button button-primary lifecycle-submit" type="button" disabled={disabled} onClick={() => void executeAction()}>
          {pending ? "Transaction in progress…" : config.button}
        </button>
        <TransactionStatus state={transaction} />
      </div>
    </section>
  );
}
