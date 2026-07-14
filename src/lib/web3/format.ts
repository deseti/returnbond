import { formatEther } from "viem";

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatMonBalance(value: bigint): string {
  const amount = Number(formatEther(value));

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: amount < 1 ? 5 : 3,
  }).format(amount);
}

