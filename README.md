# ReturnBond

ReturnBond is a mobile-first application for peer-to-peer physical item lending. It gives an owner, borrower, and neutral arbiter a shared agreement while a native MON security deposit is held by an onchain contract.

## The practical problem

Everyday loans between friends, neighbors, or community members often depend on awkward conversations about deposits, damage, and return dates. Giving the deposit directly to the owner creates another trust problem: the borrower has to trust that it will be returned fairly.

## The solution

ReturnBond records the loan roles and deadlines in a smart contract. The borrower locks the exact security deposit in that contract, not in the owner's wallet. A successful return releases the deposit to the borrower. A predefined neutral arbiter can split the deposit only when the borrower disputes a damage claim.

## Current architecture

- A Next.js App Router frontend provides the public landing page, authenticated dashboard, create-agreement form, and live agreement detail route.
- Privy handles Google, X, and external EVM wallet authentication. Social-login users without a linked wallet receive an embedded EVM wallet.
- Privy's Wagmi integration provides the active wallet connection to Wagmi and Viem.
- TanStack Query manages live RPC query state.
- The Solidity contract stores agreement state and escrows native MON deposits.
- Application blockchain data comes directly from the deployed contract and the configured Monad Testnet RPC. The application does not substitute mock data when live reads fail.

## Phase 2: create an agreement

An authenticated owner with an active EVM wallet can open `/create` and record a new agreement on Monad Testnet. The form validates the item metadata URI, distinct owner/borrower/arbiter addresses, positive MON deposit, future deadlines, and positive inspection and claim-response periods. Local date and time inputs are converted to Unix seconds, and the MON value is converted to wei without floating-point arithmetic.

The transaction flow is entirely live:

1. The client validates the form and requires Monad Testnet (chain ID `10143`).
2. The configured ReturnBond contract call is simulated with the connected owner address.
3. The connected Privy/Wagmi wallet asks the owner to confirm the real `createAgreement` transaction.
4. The app displays the submitted transaction hash and waits for a successful receipt.
5. It decodes `AgreementCreated` from that receipt and navigates using the emitted agreement ID.
6. `/agreements/[agreementId]` reads `getAgreement` directly from the deployed contract and displays only the returned onchain data.

Success is never inferred from `totalAgreementCount`, and the app does not substitute a mock agreement when an RPC or contract read fails.

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

## Current limitations

Phase 2 implements agreement creation and live, read-only agreement details only. Metadata upload is not included, so owners must provide a real accessible HTTPS, HTTP, or IPFS URI. Deposit funding, handover, return, claims, disputes, settlement, and all other agreement lifecycle actions are not implemented in the application yet.

There is no backend, database, or indexer. Signing in does not send an onchain transaction; only an explicit, simulated create-agreement confirmation can submit a write.
