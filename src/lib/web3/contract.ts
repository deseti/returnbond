import { publicEnv } from "@/config/env";
import { monadTestnet } from "@/config/monad-testnet";

export const returnBondContract = {
  address: publicEnv.NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS,
  explorerUrl: `${monadTestnet.blockExplorers.default.url}/address/${publicEnv.NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS}`,
} as const;

