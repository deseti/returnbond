"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { publicEnv } from "@/config/env";
import { monadTestnet } from "@/config/monad-testnet";
import { wagmiConfig } from "@/config/wagmi";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <PrivyProvider
      appId={publicEnv.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        loginMethods: ["google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        supportedChains: [monadTestnet],
        defaultChain: monadTestnet,
        appearance: {
          theme: "#f7f1e5",
          accentColor: "#2f6758",
          landingHeader: "Welcome to ReturnBond",
          loginMessage: "Sign in to manage item loans and security deposits.",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
          walletList: ["detected_wallets", "wallet_connect"],
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              className: "returnbond-toast",
            }}
          />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

