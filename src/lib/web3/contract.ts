import { publicEnv } from "@/config/env";
import { monadTestnet } from "@/config/monad-testnet";
import { returnBondAbi } from "@/lib/web3/returnbond-abi";

export const returnBondContract = {
  address: publicEnv.NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS,
  abi: returnBondAbi,
  explorerUrl: `${monadTestnet.blockExplorers.default.url}/address/${publicEnv.NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS}`,
} as const;

export function getAddressExplorerUrl(address: string): string {
  return `${monadTestnet.blockExplorers.default.url}/address/${address}`;
}

export function getTransactionExplorerUrl(hash: string): string {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
}
