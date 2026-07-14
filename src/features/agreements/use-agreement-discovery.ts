"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";
import {
  agreementQueryKeys,
  type AgreementRole,
} from "@/lib/web3/agreement-queries";
import { normalizeAgreement, type OnchainAgreement } from "@/lib/web3/agreement";
import { returnBondContract } from "@/lib/web3/contract";

// Keeps each RPC request small while retaining deterministic sequential reads.
const AGREEMENT_DETAIL_BATCH_SIZE = 20;

export type DiscoveredAgreement = {
  agreement: OnchainAgreement;
  roles: AgreementRole[];
};

export function useAgreementDiscovery(address?: Address, enabled = true) {
  const publicClient = usePublicClient({ chainId: monadTestnet.id });

  return useQuery({
    queryKey: agreementQueryKeys.discovery(address),
    enabled: enabled && Boolean(address) && Boolean(publicClient),
    retry: false,
    queryFn: async (): Promise<DiscoveredAgreement[]> => {
      if (!address || !publicClient) {
        throw new Error("The Monad Testnet RPC client or wallet is unavailable.");
      }

      const [ownerIds, borrowerIds, arbiterIds] = await Promise.all([
        publicClient.readContract({
          ...returnBondContract,
          functionName: "getOwnerAgreementIds",
          args: [address],
        }),
        publicClient.readContract({
          ...returnBondContract,
          functionName: "getBorrowerAgreementIds",
          args: [address],
        }),
        publicClient.readContract({
          ...returnBondContract,
          functionName: "getArbiterAgreementIds",
          args: [address],
        }),
      ]);

      const rolesById = new Map<string, { id: bigint; roles: AgreementRole[] }>();
      const addRole = (ids: readonly bigint[], role: AgreementRole) => {
        for (const id of ids) {
          const key = id.toString();
          const existing = rolesById.get(key);
          if (existing) {
            if (!existing.roles.includes(role)) existing.roles.push(role);
          } else {
            rolesById.set(key, { id, roles: [role] });
          }
        }
      };

      addRole(ownerIds, "Owner");
      addRole(borrowerIds, "Borrower");
      addRole(arbiterIds, "Arbiter");

      const records = [...rolesById.values()].sort((a, b) =>
        a.id === b.id ? 0 : a.id > b.id ? -1 : 1,
      );
      if (records.length === 0) return [];

      const discovered: DiscoveredAgreement[] = [];
      for (
        let start = 0;
        start < records.length;
        start += AGREEMENT_DETAIL_BATCH_SIZE
      ) {
        const batch = records.slice(start, start + AGREEMENT_DETAIL_BATCH_SIZE);
        const results = await publicClient.multicall({
          allowFailure: true,
          contracts: batch.map(({ id }) => ({
            ...returnBondContract,
            functionName: "getAgreement" as const,
            args: [id] as const,
          })),
        });

        if (results.every((result) => result.status === "failure")) {
          throw new Error(
            `Agreement detail batch ${Math.floor(start / AGREEMENT_DETAIL_BATCH_SIZE) + 1} failed completely.`,
          );
        }

        results.forEach((result, index) => {
          const record = batch[index];
          if (!record || result.status !== "success") return;
          discovered.push({
            agreement: normalizeAgreement(result.result),
            roles: record.roles,
          });
        });
      }
      if (discovered.length === 0) {
        throw new Error("The agreement IDs were found, but no agreement record could be read from the contract.");
      }
      return discovered;
    },
  });
}
