import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { monadTestnet } from "@/config/monad-testnet";

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

