# ReturnBond

ReturnBond is a mobile-first application for peer-to-peer physical item lending. It gives an owner, borrower, and neutral arbiter a shared agreement while a native MON security deposit is held by an onchain contract.

## The practical problem

Everyday loans between friends, neighbors, or community members often depend on awkward conversations about deposits, damage, and return dates. Giving the deposit directly to the owner creates another trust problem: the borrower has to trust that it will be returned fairly.

## The solution

ReturnBond records the loan roles and deadlines in a smart contract. The borrower locks the exact security deposit in that contract, not in the owner's wallet. A successful return releases the deposit to the borrower. A predefined neutral arbiter can split the deposit only when the borrower disputes a damage claim.

## Current architecture

- A Next.js App Router frontend provides the public landing page and authenticated dashboard.
- Privy handles Google, X, and external EVM wallet authentication. Social-login users without a linked wallet receive an embedded EVM wallet.
- Privy's Wagmi integration provides the active wallet connection to Wagmi and Viem.
- TanStack Query manages live RPC query state.
- The Solidity contract stores agreement state and escrows native MON deposits.
- Application blockchain data comes directly from the deployed contract and the configured Monad Testnet RPC. The application does not substitute mock data when live reads fail.

## Technology stack

- Next.js 16, React 19, and strict TypeScript
- Tailwind CSS 4
- Privy React SDK and Privy Wagmi integration
- Wagmi, Viem, and TanStack Query
- Lucide React and Sonner
- Solidity 0.8.28, Foundry, and OpenZeppelin Contracts

## Monad Testnet

- Network: Monad Testnet
- Chain ID: `10143`
- Native currency: `MON`
- Explorer: [MonadVision](https://testnet.monadvision.com)
- Verified ReturnBond contract: [`0x663024D51C495Ad64E5CCD319F22Ad929916b69E`](https://testnet.monadvision.com/address/0x663024D51C495Ad64E5CCD319F22Ad929916b69E)

## Local development

Requirements:

- Node.js compatible with Next.js 16
- npm
- Foundry for contract commands
- A Privy application configured for Google, X, and external EVM wallet login

Install dependencies:

```bash
npm install
```

Create a local `.env.local` file with these public configuration names:

```text
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_MONAD_RPC_URL=
NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS=
```

The application validates all three values at development and build time. The RPC value must be an HTTP or HTTPS URL, and the contract value must be a valid EVM address. No fallback values are provided.

Start the frontend:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Contract build and test

Run these commands from `contracts/`:

```bash
forge fmt --check
forge build
forge test -vvv
forge test --gas-report
```

## Phase 1 limitations

Phase 1 provides application configuration, Monad Testnet connectivity, Privy authentication, active-wallet state, native MON balance reads, and deployed-contract availability checks. It does not yet include agreement discovery, agreement creation, contract write actions, notifications, a backend, a database, or an indexer.

The dashboard is intentionally read-only. Signing in does not send an onchain transaction.
