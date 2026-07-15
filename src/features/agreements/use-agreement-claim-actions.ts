"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { decodeEventLog, type Hash } from "viem";
import { useBalance, useBlock, usePublicClient } from "wagmi";
import {
  isTransactionPending,
  type TransactionState,
} from "@/components/ui/transaction-status";
import { monadTestnet } from "@/config/monad-testnet";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";
import { isSafeExternalUri, type OnchainAgreement } from "@/lib/web3/agreement";
import { agreementQueryKeys } from "@/lib/web3/agreement-queries";
import { returnBondContract } from "@/lib/web3/contract";
import {
  explainContractError,
  isRpcError,
  isUserRejectedError,
} from "@/lib/web3/errors";

export type ClaimAction =
  | "damage"
  | "overdue"
  | "accept"
  | "dispute"
  | "finalize"
  | "resolve";

export type ClaimExecution = {
  action: ClaimAction;
  amount?: bigint;
  evidenceUri?: string;
};

const ZERO = BigInt(0);

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isPayoutAction(action: ClaimAction): boolean {
  return action === "accept" || action === "finalize" || action === "resolve";
}

export function useAgreementClaimActions({
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
    query: {
      enabled:
        wallet.chainId === monadTestnet.id &&
        [2, 3, 4].includes(agreement.status),
    },
  });
  const ownerBalance = useBalance({
    address: agreement.owner,
    chainId: monadTestnet.id,
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
  const [transactionAction, setTransactionAction] = useState<ClaimAction>();

  const inspectionDeadline =
    agreement.returnRequestTimestamp + agreement.inspectionPeriod;
  const claimResponseDeadline =
    agreement.claimCreationTimestamp + agreement.claimResponsePeriod;
  const borrowerRefund = agreement.depositAmount - agreement.claimAmount;
  const isOwner = Boolean(
    wallet.address && sameAddress(wallet.address, agreement.owner),
  );
  const isBorrower = Boolean(
    wallet.address && sameAddress(wallet.address, agreement.borrower),
  );
  const isArbiter = Boolean(
    wallet.address && sameAddress(wallet.address, agreement.arbiter),
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
    (agreement.status === 2 && isOwner) ||
    (agreement.status === 3 && isOwner) ||
    (agreement.status === 4 && (isOwner || isBorrower)) ||
    (agreement.status === 5 && isArbiter);
  const needsChainTime = [2, 3, 4].includes(agreement.status);

  const availableActions: ClaimAction[] = [];
  if (signerSynchronized && block.data && isOwner) {
    if (
      agreement.status === 3 &&
      block.data.timestamp < inspectionDeadline
    ) {
      availableActions.push("damage");
    }
    if (
      agreement.status === 2 &&
      block.data.timestamp >= agreement.returnDeadline
    ) {
      availableActions.push("overdue");
    }
    if (
      agreement.status === 4 &&
      block.data.timestamp >= claimResponseDeadline
    ) {
      availableActions.push("finalize");
    }
  }
  if (
    signerSynchronized &&
    block.data &&
    agreement.status === 4 &&
    isBorrower &&
    block.data.timestamp < claimResponseDeadline
  ) {
    availableActions.push("accept", "dispute");
  }
  if (signerSynchronized && agreement.status === 5 && isArbiter) {
    availableActions.push("resolve");
  }

  const pending = isTransactionPending(transaction);

  async function executeAction(input: ClaimExecution): Promise<void> {
    if (pending || !availableActions.includes(input.action)) return;
    setTransactionAction(input.action);

    const submittedEvidenceUri = input.evidenceUri?.trim();
    if (input.action === "damage" || input.action === "overdue") {
      if (
        input.amount === undefined ||
        input.amount <= ZERO ||
        input.amount > agreement.depositAmount
      ) {
        setTransaction({
          stage: "simulation-error",
          message: "Enter a claim amount greater than zero and no more than the recorded deposit.",
        });
        return;
      }
      if (!submittedEvidenceUri || !isSafeExternalUri(submittedEvidenceUri)) {
        setTransaction({
          stage: "simulation-error",
          message: "Enter a valid HTTPS, HTTP, or IPFS claim-evidence URI.",
        });
        return;
      }
    }
    if (
      input.action === "resolve" &&
      (input.amount === undefined ||
        input.amount < ZERO ||
        input.amount > agreement.depositAmount)
    ) {
      setTransaction({
        stage: "simulation-error",
        message: "Enter an owner award from zero through the full recorded deposit.",
      });
      return;
    }

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
      setTransaction({ stage: "simulating" });
      if (input.action === "damage") {
        const args = [agreement.id, input.amount!, submittedEvidenceUri!] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "raiseDamageClaim",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "raiseDamageClaim",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (input.action === "overdue") {
        const args = [agreement.id, input.amount!, submittedEvidenceUri!] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "raiseOverdueClaim",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "raiseOverdueClaim",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (input.action === "accept") {
        const args = [agreement.id] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "acceptClaim",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "acceptClaim",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (input.action === "dispute") {
        const args = [agreement.id] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "disputeClaim",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "disputeClaim",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else if (input.action === "finalize") {
        const args = [agreement.id] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "finalizeUnansweredClaim",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "finalizeUnansweredClaim",
          args,
        });
        submitTransaction = () => walletClient.writeContract(simulation.request);
      } else {
        const args = [agreement.id, input.amount!] as const;
        const simulation = await publicClient.simulateContract({
          account: writeAddress,
          ...returnBondContract,
          functionName: "resolveDispute",
          args,
        });
        setTransaction({ stage: "estimating" });
        await publicClient.estimateContractGas({
          account: writeAddress,
          ...returnBondContract,
          functionName: "resolveDispute",
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

      const expectedOwnerAward =
        input.action === "resolve" ? input.amount! : agreement.claimAmount;
      const expectedBorrowerRefund = agreement.depositAmount - expectedOwnerAward;
      let claimTimestamp: bigint | undefined;
      let expectedEventFound = false;
      for (const log of receipt.logs) {
        if (!sameAddress(log.address, returnBondContract.address)) continue;
        try {
          const decoded = decodeEventLog({
            abi: returnBondContract.abi,
            data: log.data,
            topics: log.topics,
          });
          if (
            (input.action === "damage" || input.action === "overdue") &&
            decoded.eventName === "ClaimRaised"
          ) {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.owner, agreement.owner) &&
              sameAddress(decoded.args.owner, writeAddress) &&
              decoded.args.claimAmount === input.amount &&
              decoded.args.claimEvidenceURI === submittedEvidenceUri &&
              decoded.args.overdue === (input.action === "overdue") &&
              decoded.args.claimCreationTimestamp > ZERO;
            if (expectedEventFound) {
              claimTimestamp = decoded.args.claimCreationTimestamp;
            }
          }
          if (input.action === "dispute" && decoded.eventName === "ClaimDisputed") {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              sameAddress(decoded.args.borrower, writeAddress) &&
              sameAddress(decoded.args.arbiter, agreement.arbiter);
          }
          if (input.action === "accept" && decoded.eventName === "ClaimAccepted") {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              sameAddress(decoded.args.borrower, writeAddress) &&
              sameAddress(decoded.args.owner, agreement.owner) &&
              decoded.args.ownerAward === expectedOwnerAward &&
              decoded.args.borrowerRefund === expectedBorrowerRefund;
          }
          if (input.action === "finalize" && decoded.eventName === "ClaimFinalized") {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.owner, agreement.owner) &&
              sameAddress(decoded.args.owner, writeAddress) &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              decoded.args.ownerAward === expectedOwnerAward &&
              decoded.args.borrowerRefund === expectedBorrowerRefund;
          }
          if (input.action === "resolve" && decoded.eventName === "DisputeResolved") {
            expectedEventFound =
              decoded.args.agreementId === agreement.id &&
              sameAddress(decoded.args.arbiter, agreement.arbiter) &&
              sameAddress(decoded.args.arbiter, writeAddress) &&
              sameAddress(decoded.args.owner, agreement.owner) &&
              sameAddress(decoded.args.borrower, agreement.borrower) &&
              decoded.args.ownerAward === expectedOwnerAward &&
              decoded.args.borrowerRefund === expectedBorrowerRefund;
          }
          if (expectedEventFound) break;
        } catch {
          // Settlement recipients may emit unrelated logs in the same receipt.
        }
      }
      if (!expectedEventFound) {
        setTransaction({
          stage: "verification-error",
          hash,
          message: "The receipt succeeded, but its claim lifecycle event did not match every expected agreement field.",
        });
        return;
      }

      const liveAgreement = await publicClient.readContract({
        ...returnBondContract,
        functionName: "getAgreement",
        args: [agreement.id],
      });
      const expectedStatus =
        input.action === "damage" || input.action === "overdue"
          ? 4
          : input.action === "dispute"
            ? 5
            : input.action === "resolve" && expectedOwnerAward === ZERO
              ? 6
              : 7;
      const raisedClaimMatches =
        input.action !== "damage" && input.action !== "overdue"
          ? true
          : liveAgreement.claimAmount === input.amount &&
            liveAgreement.claimEvidenceURI === submittedEvidenceUri &&
            liveAgreement.claimCreationTimestamp === claimTimestamp;
      if (liveAgreement.status !== expectedStatus || !raisedClaimMatches) {
        setTransaction({
          stage: "verification-error",
          hash,
          message: "The receipt succeeded, but the latest live agreement state did not match the expected claim transition and stored fields.",
        });
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agreementQueryKeys.all }),
        onAgreementChanged(),
      ]);
      if (isPayoutAction(input.action)) {
        const [ownerRefresh, borrowerRefresh] = await Promise.all([
          ownerBalance.refetch(),
          borrowerBalance.refetch(),
        ]);
        if (ownerRefresh.isError || borrowerRefresh.isError) {
          setTransaction({
            stage: "rpc-error",
            hash,
            message: "The payout state was verified, but the owner and borrower balance refresh did not complete successfully.",
          });
          return;
        }
      }

      setTransaction({ stage: "confirmed", hash });
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isRpcError(error) ? "rpc-error" : "verification-error",
        hash,
        message: "The transaction was submitted, but its receipt, event, live state, and refresh could not be fully confirmed.",
        technical: explained.technical,
      });
    }
  }

  return {
    availableActions,
    block,
    borrowerRefund,
    claimResponseDeadline,
    correctNetwork,
    executeAction,
    inspectionDeadline,
    needsChainTime,
    pending,
    potentiallyAuthorized,
    signerSynchronized,
    transaction,
    transactionAction,
  };
}
