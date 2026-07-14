import type { Address } from "viem";

export type AgreementRole = "Owner" | "Borrower" | "Arbiter";

export const agreementQueryKeys = {
  all: ["returnbond", "agreements"] as const,
  discovery: (address?: Address) =>
    ["returnbond", "agreements", "discovery", address] as const,
  detail: (agreementId: bigint) =>
    ["returnbond", "agreements", "detail", agreementId.toString()] as const,
};
