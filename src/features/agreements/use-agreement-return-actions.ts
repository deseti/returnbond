"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { decodeEventLog, type Hash } from "viem";
import { useBalance, useBlock, usePublicClient } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";
import {
  isTransactionPending,
  type TransactionState,
} from "@/components/ui/transaction-status";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";
import {
  isSafeExternalUri,
  type OnchainAgreement,
} from "@/lib/web3/agreement";
import { agreementQueryKeys } from "@/lib/web3/agreement-queries";
import { returnBondContract } from "@/lib/web3/contract";
import {
  explainContractError,
  isRpcError,
  isUserRejectedError,
} from "@/lib/web3/errors";

export type ReturnAction = "request" | "confirm" | "finalize";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function useAgreementReturnActions({
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
  const borrowerBalance = useBalance({
    address: agreement.borrower,
    chainId: monadTestnet.id,
    query: { enabled: wallet.chainId === monadTestnet.id },
  });
  const [transaction, setTransaction] = useState<TransactionState>({
    stage: "idle",
  });
  const [transactionAction, setTransactionAction] =
    useState<ReturnAction>();

  const inspectionDeadline =
    agreement.returnRequestTimestamp + agreement.inspectionPeriod;
  const isBorrower = Boolean(
    wallet.address && sameAddress(wallet.address, agreement.borrower),
  );
  const isOwner = Boolean(
    wallet.address && sameAddress(wallet.address, agreement.owner),
  );
  const correctNetwork = wallet.chainId === monadTestnet.id;
  const signerSynchronized = Boolean(
    wallet.writeAddress &&
      wallet.walletClient &&
      !wallet.signerMismatch &&
      wallet.walletClient.chain?.id === monadTestnet.id &&
      correctNetwork,
  );
  const potentiallyAuthorized =
    (agreement.status === 2 && isBorrower) ||
    (agreement.status === 3 && (isOwner || isBorrower));

  let action: ReturnAction | undefined;
  if (signerSynchronized && agreement.status === 2 && isBorrower) {
    action = "request";
  }
  if (
    signerSynchronized &&
    block.data &&
    agreement.status === 3 &&
    isOwner &&
    block.data.timestamp < inspectionDeadline
  ) {
    action = "confirm";
  }
  if (
    signerSynchronized &&
    block.data &&
    agreement.status === 3 &&
    isBorrower &&
    block.data.timestamp >= inspectionDeadline
  ) {
    action = "finalize";
  }

  const pending = isTransactionPending(transaction);

  async function executeAction(
    requestedAction: ReturnAction,
    rawProofUri?: string,
  ): Promise<void> {
    if (pending || requestedAction !== action) return;
    setTransactionAction(requestedAction);

    const submittedProofUri = rawProofUri?.trim();
    if (
      requestedAction === "request" &&
      (!submittedProofUri || !isSafeExternalUri(submittedProofUri))
    ) {
      setTransaction({
        stage: "simulation-error",
        message: "Enter a valid HTTPS, HTTP, or IPFS return-proof URI.",
      });
      return;
    }

    setTransaction({ stage: "estimating" });
    if (!publicClient || !wallet.writeAddress || !wallet.walletClient) {
      setTransaction({
        stage: "rpc-error",
        message: wallet.signerMismatch
          ? "The connected account and signing wallet are out of sync. Reconnect before submitting."
          : "An active synchronized wallet signer and Monad Testnet RPC client are required.",
      });
      return;
    }
    if (
      wallet.chainId !== monadTestnet.id ||
      wallet.walletClient.chain?.id !== monadTestnet.id
    ) {
      setTransaction({
        stage: "rpc-error",
        message: "Switch the active signing wallet to Monad Testnet before submitting.",
      });
      return;
    }

    const walletClient = wallet.walletClient;
    const writeAddress = wallet.writeAddress;
    let submitTransaction: () => Promise<Hash>;
    try {
      if (requestedAction === "request") {
        const args = [agreement.id, submittedProofUri!] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "requestReturn",
          args,
        });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "requestReturn",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (requestedAction === "confirm") {
        const args = [agreement.id] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "confirmSuccessfulReturn",
          args,
        });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "confirmSuccessfulReturn",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else {
        const args = [agreement.id] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "finalizeUnansweredReturn",
          args,
        });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "finalizeUnansweredReturn",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
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
        setTransaction({
          stage: "reverted",
          hash,
          message: "The confirmed receipt reports a reverted transaction.",
        });
        return;
      }

      let expectedEventFound = false;
      for (const log of receipt.logs) {
        if (!sameAddress(log.address, returnBondContract.address)) continue;
        try {
          const decoded = decodeEventLog({
            abi: returnBondContract.abi,
            data: log.data,
            topics: log.topics,
          });
          if (requestedAction === "request" && decoded.eventName === "ReturnRequested") {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              sameAddress(decoded.args.borrower, writeAddress) &&
              decoded.args.returnProofURI === submittedProofUri;
          }
          if (requestedAction !== "request" && decoded.eventName === "ReturnConfirmed") {
            const expectedTimedOut = requestedAction === "finalize";
            const expectedActor = requestedAction === "confirm"
              ? agreement.owner
              : agreement.borrower;
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.actor, writeAddress) &&
              sameAddress(decoded.args.actor, expectedActor) &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              decoded.args.refundedAmount === agreement.depositAmount &&
              decoded.args.timedOut === expectedTimedOut;
          }
          if (expectedEventFound) break;
        } catch {
          // A receipt may contain unrelated logs from native-token recipients.
        }
      }
      if (!expectedEventFound) {
        setTransaction({
          stage: "verification-error",
          hash,
          message: "The receipt succeeded, but its return lifecycle event did not match the expected agreement data.",
        });
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agreementQueryKeys.all }),
        onAgreementChanged(),
        requestedAction === "request" ? Promise.resolve() : borrowerBalance.refetch(),
      ]);

      const liveAgreement = await publicClient.readContract({
        ...returnBondContract,
        functionName: "getAgreement",
        args: [agreement.id],
      });
      const expectedStatus = requestedAction === "request" ? 3 : 6;
      const proofMatches =
        requestedAction !== "request" ||
        liveAgreement.returnProofURI === submittedProofUri;
      if (liveAgreement.status !== expectedStatus || !proofMatches) {
        setTransaction({
          stage: "verification-error",
          hash,
          message: requestedAction === "request"
            ? "The receipt succeeded, but live state did not confirm Return requested with the submitted proof URI."
            : "The receipt succeeded, but live state did not confirm the deposit as Refunded.",
        });
        return;
      }

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

  return {
    action,
    block,
    correctNetwork,
    executeAction,
    inspectionDeadline,
    pending,
    potentiallyAuthorized,
    signerSynchronized,
    transaction,
    transactionAction,
  };
}
