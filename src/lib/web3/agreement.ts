import type { ContractFunctionReturnType } from "viem";
import { returnBondAbi } from "@/lib/web3/returnbond-abi";

export const AGREEMENT_STATUS_LABELS = [
  "Created",
  "Funded",
  "Active",
  "Return requested",
  "Claim requested",
  "Disputed",
  "Refunded",
  "Claimed",
  "Cancelled",
] as const;

export type AgreementStatus =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8;

type AgreementResult = ContractFunctionReturnType<
  typeof returnBondAbi,
  "view",
  "getAgreement"
>;

export type OnchainAgreement = AgreementResult & {
  status: AgreementStatus;
};

export function normalizeAgreement(
  agreement: AgreementResult,
): OnchainAgreement {
  return {
    ...agreement,
    status: agreement.status as AgreementStatus,
  };
}

export function getAgreementStatusLabel(status: number): string {
  return AGREEMENT_STATUS_LABELS[status] ?? `Unknown (${status})`;
}

export function isSafeExternalUri(value: string): boolean {
  if (value.startsWith("ipfs://")) return value.length > "ipfs://".length;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getSafeMetadataLink(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    // IPFS URIs are handled below; all other malformed values remain unlinked.
  }

  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (path && !path.includes("..")) {
      return `https://ipfs.io/ipfs/${path}`;
    }
  }

  return undefined;
}
