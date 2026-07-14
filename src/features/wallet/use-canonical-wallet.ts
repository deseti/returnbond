"use client";

import { useActiveWallet } from "@privy-io/react-auth";
import { getAddress, isAddress, type Address } from "viem";
import { useConnection, useWalletClient } from "wagmi";

function normalizeAddress(value?: string): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  return getAddress(value);
}

function activeWalletChainId(chainId?: string): number | undefined {
  if (!chainId?.startsWith("eip155:")) return undefined;
  const value = Number(chainId.slice("eip155:".length));
  return Number.isSafeInteger(value) ? value : undefined;
}

export function useCanonicalWallet() {
  const connection = useConnection();
  const walletClient = useWalletClient();
  const { wallet: activeWallet } = useActiveWallet();

  const connectionAddress = normalizeAddress(connection.address);
  const privyAddress =
    activeWallet?.type === "ethereum"
      ? normalizeAddress(activeWallet.address)
      : undefined;
  const signerAddress = normalizeAddress(walletClient.data?.account.address);
  const signerMismatch = Boolean(
    connectionAddress &&
      signerAddress &&
      connectionAddress !== signerAddress,
  );
  const canonicalAddress = connectionAddress ?? signerAddress ?? privyAddress;
  const writeAddress = signerMismatch ? undefined : signerAddress;

  return {
    address: canonicalAddress,
    connectionAddress,
    signerAddress,
    writeAddress,
    chainId:
      walletClient.data?.chain?.id ??
      connection.chainId ??
      activeWalletChainId(
        activeWallet?.type === "ethereum" ? activeWallet.chainId : undefined,
      ),
    connection,
    walletClient: walletClient.data,
    walletClientPending: walletClient.isPending,
    signerMismatch,
  };
}
