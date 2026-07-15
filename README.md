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

## Phase 4: return and deposit refund

The live agreement route extends the Phase 3 lifecycle with the contract's real successful-return paths:

- The borrower can submit a non-empty HTTPS, HTTP, or IPFS return-proof URI while an agreement is `Active`. The app simulates `requestReturn`, verifies the decoded `ReturnRequested` receipt event, and confirms both `ReturnRequested` status and the exact stored URI from live contract state.
- Before the chain-derived inspection deadline, the owner can explicitly confirm that the item was returned and inspected. The zero-value `confirmSuccessfulReturn` call returns the full recorded deposit to the borrower only after wallet approval. The app verifies the decoded refund event and `Refunded` status.
- At or after the exact inspection deadline, the borrower can use `finalizeUnansweredReturn` when the owner has not responded. This zero-value action follows the contract's timeout boundary and verifies the timed-out refund event and live `Refunded` status.

Return-proof URIs are participant assertions stored onchain. ReturnBond does not upload proof content or independently verify the physical return. All eligibility checks use the synchronized Privy/Wagmi signer on Monad Testnet, and timeout authority comes from the latest chain block rather than browser time. Transaction evidence remains visible after a successful status transition removes the action.

## Phase 4 live smoke test

A manual Monad Testnet smoke test completed the successful-return path for agreement `#1`, **Cordless Drill**, with a `0.25 MON` deposit. The owner was `0x6d5f11D97f483E42a4Af58669d4798A8946a9308`, the borrower was `0x32F251fc36A1174901124589EAC2d4E391816F69`, and the deployed contract was `0x663024D51C495Ad64E5CCD319F22Ad929916b69E`.

- `Active` → `ReturnRequested`: `requestReturn` succeeded with `0 MON` and the submitted proof URI [`https://raw.githubusercontent.com/deseti/returnbond/main/public/demo-items/cordless-drill.png`](https://raw.githubusercontent.com/deseti/returnbond/main/public/demo-items/cordless-drill.png). [View the transaction on MonadVision](https://testnet.monadvision.com/tx/0xf508d6fdf5ec46762ffc65be44e717b3380166ae531fd48a2b1fbb4c82b1f2df).
- `ReturnRequested` → `Refunded`: `confirmSuccessfulReturn` succeeded with a transaction value of `0 MON` and transferred exactly `0.25 MON` internally from the ReturnBond contract to the borrower. [View the transaction on MonadVision](https://testnet.monadvision.com/tx/0x638ee382254d6d478b37768858bc3390a58d7d8cdfbb151991cb1ad221fffa93).

Agreement `#1` finished with the live status `Refunded`. The smoke test recorded the submitted proof URI but did not independently verify the proof content. The `finalizeUnansweredReturn` timeout path remains manually untested.

## Phase 3: agreement discovery and funding

An authenticated user with a synchronized Privy/Wagmi EVM wallet can discover their real agreements on `/dashboard`. The app reads the deployed contract's owner, borrower, and arbiter ID lists for the canonical wallet, merges duplicate IDs while preserving every role, and loads the corresponding agreement records directly from Monad Testnet. It does not scan `totalAgreementCount`, use an indexer, or substitute static data when RPC reads fail.

The live agreement detail route now exposes only the Phase 3 action authorized by contract role, status, network, and chain-derived deadline state:

- A borrower can fund a `Created` agreement strictly before the handover deadline. The app simulates the call, sends the exact recorded deposit to the contract, estimates live gas, and checks the borrower's MON balance before submission.
- An owner can explicitly attest that physical handover occurred and move a `Funded` agreement to `Active` strictly before the handover deadline.
- At or after the handover deadline, the borrower can cancel a still-`Funded` agreement and recover the full recorded deposit.

Every lifecycle transaction displays the submitted hash, waits for a successful receipt, and then verifies the expected status from live contract state before reporting confirmation. Wallet rejection, simulation failure, revert, RPC failure, and post-receipt verification failure remain distinct states.

Agreement creation from Phase 2 remains available. An authenticated owner with an active EVM wallet can open `/create` and record a new agreement on Monad Testnet. The form validates the item metadata URI, distinct owner/borrower/arbiter addresses, positive MON deposit, future deadlines, and positive inspection and claim-response periods. Local date and time inputs are converted to Unix seconds, and the MON value is converted to wei without floating-point arithmetic.

The transaction flow is entirely live:

1. The client validates the form and requires Monad Testnet (chain ID `10143`).
2. The configured ReturnBond contract call is simulated with the connected owner address.
3. The connected Privy/Wagmi wallet asks the owner to confirm the real `createAgreement` transaction.
4. The app displays the submitted transaction hash and waits for a successful receipt.
5. It decodes `AgreementCreated` from that receipt and navigates using the emitted agreement ID.
6. `/agreements/[agreementId]` reads `getAgreement` directly from the deployed contract and displays only the returned onchain data.

Success is never inferred from `totalAgreementCount`, and the app does not substitute a mock agreement when an RPC or contract read fails.

## Phase 3 live smoke test

A manual Monad Testnet smoke test verified agreement `#1` for **Cordless Drill** with a `0.25 MON` deposit. The owner was `0x6d5f11D97f483E42a4Af58669d4798A8946a9308`, the borrower was `0x32F251fc36A1174901124589EAC2d4E391816F69`, and the deployed contract was `0x663024D51C495Ad64E5CCD319F22Ad929916b69E`.

- `Created` → `Funded`: `fundAgreement` succeeded with exactly `0.25 MON` sent to the contract. [View the transaction on MonadVision](https://testnet.monadvision.com/tx/0x66d67147be627a77bc0388a9a795d851bd58467bed902612c5c6dac8d9853c4a).
- `Funded` → `Active`: `confirmHandover` succeeded with `0 MON`. [View the transaction on MonadVision](https://testnet.monadvision.com/tx/0x0bd0751d61747c6092d07699436ceaa4dfaf3b85e0e83cd63b9bd19ffa07cb9b).

The expired failed-handover refund was not part of this manual smoke test.

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

Phase 4 implements agreement creation, role-based discovery, deposit funding, handover confirmation, the expired unhanded-agreement refund, return requests, owner-confirmed successful returns, and timed-out unanswered-return refunds. Metadata and proof upload are not included, so participants must provide a real accessible HTTPS, HTTP, or IPFS URI. Damage claims, overdue claims, disputes, arbitration, and later claim settlement paths are not implemented in the application yet.

There is no backend, database, or indexer. Signing in and reading agreements do not send transactions. Only an explicit, simulated lifecycle action can submit a write after manual wallet approval. Manual Monad Testnet verification covers funding, handover confirmation, a return request, and owner-confirmed successful-return refund. The expired failed-handover refund and `finalizeUnansweredReturn` remain manually untested.
