# ReturnBond contracts

`ReturnBond` escrows a native MON security deposit for a peer-to-peer physical item lending agreement. Each agreement is independent, names one owner, one borrower, and one neutral arbiter, and follows a fixed state machine. The contract has no administrator, fees, upgrade mechanism, generic withdrawal, `receive`, or `fallback` function.

No ReturnBond contract has been deployed yet, so this repository intentionally contains no contract address.

## Roles

- **Owner:** creates the agreement, confirms physical handover, confirms a successful return, or raises a claim within the allowed window.
- **Borrower:** funds the exact deposit, requests return confirmation, accepts or disputes a claim, and invokes borrower-only timeout refunds.
- **Arbiter:** resolves only agreements that the borrower has explicitly disputed. The arbiter cannot create a claim or act on an undisputed claim.

The three role addresses must be non-zero and distinct for every agreement.

## State machine

```text
Created --owner cancels-------------------------------> Cancelled
Created --borrower funds exact deposit before deadline> Funded
Funded --owner confirms handover before deadline-----> Active
Funded --borrower finalizes at/after deadline--------> Cancelled (full refund)
Active --borrower requests return--------------------> ReturnRequested
Active --owner raises claim at/after return deadline-> ClaimRequested
ReturnRequested --owner confirms before inspection---> Refunded
ReturnRequested --borrower finalizes after timeout----> Refunded
ReturnRequested --owner raises claim before timeout---> ClaimRequested
ClaimRequested --borrower accepts before timeout------> Claimed
ClaimRequested --borrower disputes before timeout-----> Disputed
ClaimRequested --owner finalizes after timeout--------> Claimed
Disputed --arbiter awards zero to owner---------------> Refunded
Disputed --arbiter awards any positive amount---------> Claimed
```

`Refunded`, `Claimed`, and `Cancelled` are terminal. A terminal agreement cannot transition again.

## Lifecycle and timeout behavior

1. The owner creates an agreement with item metadata, a positive deposit, deadlines, positive inspection and claim-response periods, and the designated borrower and arbiter.
2. Only the borrower can fund it strictly before the handover deadline, and `msg.value` must equal the configured deposit exactly.
3. The owner must confirm handover strictly before the handover deadline. At or after that deadline, the borrower can cancel the failed handover and recover the full deposit.
4. While active, the borrower can request return confirmation with a non-empty proof URI. The owner can confirm the return or raise a damage claim strictly before `returnRequestTimestamp + inspectionPeriod`. At or after that boundary, only the borrower can finalize the unanswered return for a full refund.
5. If no return was requested, the owner can raise an overdue claim at or after the return deadline.
6. The borrower can accept or dispute a claim strictly before `claimCreationTimestamp + claimResponsePeriod`. At or after that boundary, only the owner can finalize the unanswered claim.
7. An accepted or unanswered claim pays the recorded claim amount to the owner and returns the exact remainder to the borrower.
8. A disputed claim can be resolved only by the predefined arbiter. The arbiter may award the owner any amount from zero through the full original deposit; the exact remainder goes to the borrower.

All deadlines use explicit `<` or `>=` boundary checks. Time values and periods use `uint64`, current timestamps are range-checked before conversion, and deadline arithmetic is promoted to `uint256`.

## Security model and trust assumptions

- OpenZeppelin `ReentrancyGuard` protects every payout entry point.
- Agreement state is changed before any native-token transfer.
- Native MON is sent with low-level calls, and a rejected transfer reverts the entire settlement with a custom error.
- Each payout is calculated from that agreement's immutable deposit amount, never from the contract's global balance. Forced MON therefore cannot increase an agreement payout.
- Exact funding, status gates, role gates, and terminal states prevent duplicate funding or multiple payout paths.
- There is no owner or administrator withdrawal path.
- URI strings are attestations supplied by participants. The contract stores them but cannot verify physical handover, item condition, or off-chain content availability.
- Block timestamps are the chain's time source and have the normal bounded validator influence. Applications should choose periods that are materially longer than that influence.
- Recipients must be able to receive native MON. A rejecting recipient blocks settlement until its receiving behavior changes; funds are not redirected to another address.
- The arbiter is trusted only for disputed agreements. Once a claim is disputed, the arbiter has full discretion to split the original deposit between owner and borrower. The arbiter has no authority over any other agreement state.
- The contract has not received a third-party audit. Production use should follow an independent security review.

## Build and test

Run commands from `contracts/` with the repository's Monad Foundry installation:

```bash
forge fmt --check
forge build
forge test -vvv
forge test --gas-report
```

Tests are local and do not require Monad Testnet or any live RPC.

## Manual deployment with an encrypted Foundry keystore

Deployment is intentionally manual. Import the deployer into Foundry's encrypted keystore using its interactive prompt:

```bash
cast wallet import returnbond-deployer --interactive
```

Confirm the selected account's public address, then review the script simulation:

```bash
cast wallet address --account returnbond-deployer
forge script script/DeployReturnBond.s.sol:DeployReturnBond \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account returnbond-deployer \
  --sender "$(cast wallet address --account returnbond-deployer)"
```

After reviewing the simulation, repeat the same `forge script` command with `--broadcast`. Foundry prompts for the keystore password and signs with the selected encrypted account. The deployment script takes no constructor arguments and grants no privileges. Do not put a raw private key in an environment variable, command, source file, or `.env` file.

Record and publish the real deployed address only after a successful owner-controlled deployment and independent confirmation on Monad Testnet.
