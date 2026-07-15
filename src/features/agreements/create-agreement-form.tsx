"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useActiveWallet, usePrivy } from "@privy-io/react-auth";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  decodeEventLog,
  getAddress,
  isAddress,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  useConnection,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { z } from "zod";
import { monadTestnet } from "@/config/monad-testnet";
import { isSafeExternalUri } from "@/lib/web3/agreement";
import {
  getTransactionExplorerUrl,
  returnBondContract,
} from "@/lib/web3/contract";
import {
  explainContractError,
  isRpcError,
  isUserRejectedError,
} from "@/lib/web3/errors";

const ZERO = BigInt(0);
const UINT64_MAX = BigInt("18446744073709551615");
const UINT256_MAX = BigInt(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935",
);
const PERIOD_MULTIPLIERS = {
  minutes: BigInt(60),
  hours: BigInt(3_600),
  days: BigInt(86_400),
} as const;

const periodUnitSchema = z.enum(["minutes", "hours", "days"]);

type PeriodUnit = z.infer<typeof periodUnitSchema>;

type CreateAgreementValues = {
  itemName: string;
  itemMetadataURI: string;
  borrower: string;
  arbiter: string;
  depositAmount: string;
  handoverDeadline: string;
  returnDeadline: string;
  inspectionPeriod: string;
  inspectionUnit: PeriodUnit;
  claimResponsePeriod: string;
  claimResponseUnit: PeriodUnit;
};

type TransactionState =
  | { stage: "idle" | "validating" | "awaiting-confirmation" }
  | { stage: "submitted" | "confirming" | "confirmed"; hash: Hash }
  | {
      stage: "validation-error" | "rejected" | "simulation-error" | "rpc-error";
      message: string;
      technical?: string;
      hash?: Hash;
    };

function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDeadlines() {
  const handover = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const returnDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000);
  return {
    handoverDeadline: localInputValue(handover),
    returnDeadline: localInputValue(returnDate),
  };
}

function unixSeconds(value: string): bigint | undefined {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return undefined;
  return BigInt(Math.floor(milliseconds / 1_000));
}

function periodSeconds(value: string, unit: PeriodUnit): bigint | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  return BigInt(value) * PERIOD_MULTIPLIERS[unit];
}

function normalizeWalletAddress(value?: string): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}

function createAgreementSchema(owner?: Address) {
  const requiredAddress = z
    .string()
    .trim()
    .refine(isAddress, "Enter a valid EVM address.")
    .refine(
      (value) => !isAddress(value) || getAddress(value) !== zeroAddress,
      "The zero address cannot be used.",
    );

  return z
    .object({
      itemName: z.string().trim().min(1, "Enter an item name."),
      itemMetadataURI: z
        .string()
        .trim()
        .min(1, "Enter a metadata URI.")
        .refine(
          isSafeExternalUri,
          "Use a valid HTTPS, HTTP, or IPFS URI.",
        ),
      borrower: requiredAddress,
      arbiter: requiredAddress,
      depositAmount: z
        .string()
        .trim()
        .min(1, "Enter a deposit amount.")
        .refine((value) => {
          try {
            const wei = parseEther(value);
            return wei > ZERO && wei <= UINT256_MAX;
          } catch {
            return false;
          }
        }, "Enter a positive MON amount with no more than 18 decimals."),
      handoverDeadline: z.string().min(1, "Choose a handover deadline."),
      returnDeadline: z.string().min(1, "Choose a return deadline."),
      inspectionPeriod: z.string().trim(),
      inspectionUnit: periodUnitSchema,
      claimResponsePeriod: z.string().trim(),
      claimResponseUnit: periodUnitSchema,
    })
    .superRefine((values, context) => {
      if (isAddress(values.borrower) && isAddress(values.arbiter)) {
        const borrower = getAddress(values.borrower);
        const arbiter = getAddress(values.arbiter);
        if (borrower === arbiter) {
          context.addIssue({
            code: "custom",
            path: ["arbiter"],
            message: "The arbiter must differ from the borrower.",
          });
        }
        if (owner && borrower === owner) {
          context.addIssue({
            code: "custom",
            path: ["borrower"],
            message: "The borrower must differ from your owner wallet.",
          });
        }
        if (owner && arbiter === owner) {
          context.addIssue({
            code: "custom",
            path: ["arbiter"],
            message: "The arbiter must differ from your owner wallet.",
          });
        }
      }

      const handover = unixSeconds(values.handoverDeadline);
      const returnDeadline = unixSeconds(values.returnDeadline);
      const now = BigInt(Math.floor(Date.now() / 1_000));
      if (handover === undefined || handover <= now || handover > UINT64_MAX) {
        context.addIssue({
          code: "custom",
          path: ["handoverDeadline"],
          message: "Choose a valid future handover deadline.",
        });
      }
      if (
        returnDeadline === undefined ||
        handover === undefined ||
        returnDeadline <= handover ||
        returnDeadline > UINT64_MAX
      ) {
        context.addIssue({
          code: "custom",
          path: ["returnDeadline"],
          message: "The return deadline must be later than handover.",
        });
      }

      const periods = [
        ["inspectionPeriod", periodSeconds(values.inspectionPeriod, values.inspectionUnit)],
        [
          "claimResponsePeriod",
          periodSeconds(values.claimResponsePeriod, values.claimResponseUnit),
        ],
      ] as const;
      for (const [path, seconds] of periods) {
        if (seconds === undefined || seconds <= ZERO || seconds > UINT64_MAX) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: "Enter a positive whole-number period that fits uint64.",
          });
        }
      }
    });
}

function buildCreateAgreementArguments(values: CreateAgreementValues) {
  const handover = unixSeconds(values.handoverDeadline);
  const returnDeadline = unixSeconds(values.returnDeadline);
  const inspection = periodSeconds(values.inspectionPeriod, values.inspectionUnit);
  const claimResponse = periodSeconds(
    values.claimResponsePeriod,
    values.claimResponseUnit,
  );
  if (
    handover === undefined ||
    returnDeadline === undefined ||
    inspection === undefined ||
    claimResponse === undefined
  ) {
    throw new Error("The deadline or period values could not be normalized.");
  }

  return [
    getAddress(values.borrower.trim()),
    getAddress(values.arbiter.trim()),
    values.itemName.trim(),
    values.itemMetadataURI.trim(),
    parseEther(values.depositAmount.trim()),
    handover,
    returnDeadline,
    inspection,
    claimResponse,
  ] as const;
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}

function TransactionStatus({ state }: { state: TransactionState }) {
  if (state.stage === "idle") return null;

  const pending = [
    "validating",
    "awaiting-confirmation",
    "submitted",
    "confirming",
  ].includes(state.stage);
  const labels: Partial<Record<TransactionState["stage"], string>> = {
    validating: "Validating agreement details",
    "awaiting-confirmation": "Awaiting wallet confirmation",
    submitted: "Transaction submitted",
    confirming: "Confirming onchain",
    confirmed: "Agreement confirmed",
    "validation-error": "Validation needs attention",
    rejected: "Transaction rejected",
    "simulation-error": "Simulation failed",
    "rpc-error": "RPC request failed",
  };
  const hash = "hash" in state ? state.hash : undefined;
  const failed =
    state.stage === "validation-error" ||
    state.stage === "rejected" ||
    state.stage === "simulation-error" ||
    state.stage === "rpc-error";

  return (
    <section
      className={`transaction-status ${failed ? "transaction-status-error" : ""}`}
      aria-live="polite"
      aria-busy={pending}
    >
      {pending ? (
        <LoaderCircle className="spin" aria-hidden="true" size={20} />
      ) : failed ? (
        <CircleAlert aria-hidden="true" size={20} />
      ) : (
        <CircleCheck aria-hidden="true" size={20} />
      )}
      <div>
        <strong>{labels[state.stage]}</strong>
        {"message" in state && <p>{state.message}</p>}
        {"technical" in state && state.technical && (
          <details>
            <summary>Technical details</summary>
            <p className="technical-error">{state.technical}</p>
          </details>
        )}
        {hash && (
          <a
            className="transaction-link"
            href={getTransactionExplorerUrl(hash)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction {hash.slice(0, 10)}…{hash.slice(-6)}
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </div>
    </section>
  );
}

export function CreateAgreementForm() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallet: activeWallet } = useActiveWallet();
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const walletClient = useWalletClient();
  const switchChain = useSwitchChain();
  const [transaction, setTransaction] = useState<TransactionState>({ stage: "idle" });
  const connectionAddress = normalizeWalletAddress(connection.address);
  const walletClientAddress = normalizeWalletAddress(
    walletClient.data?.account?.address,
  );
  const signerAddressMismatch = Boolean(
    connectionAddress &&
      walletClientAddress &&
      connectionAddress !== walletClientAddress,
  );
  const ownerAddress = signerAddressMismatch
    ? undefined
    : (walletClientAddress ?? connectionAddress);
  const activeChainId =
    walletClient.data?.chain?.id ??
    connection.chainId ??
    (activeWallet?.type === "ethereum"
      ? Number(activeWallet.chainId.replace("eip155:", ""))
      : undefined);
  const schema = useMemo(() => createAgreementSchema(ownerAddress), [ownerAddress]);
  const defaults = useMemo(() => defaultDeadlines(), []);
  const form = useForm<CreateAgreementValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      itemName: "",
      itemMetadataURI: "",
      borrower: "",
      arbiter: "",
      depositAmount: "",
      handoverDeadline: defaults.handoverDeadline,
      returnDeadline: defaults.returnDeadline,
      inspectionPeriod: "24",
      inspectionUnit: "hours",
      claimResponsePeriod: "48",
      claimResponseUnit: "hours",
    },
  });
  const errors = form.formState.errors;
  const isPending = [
    "validating",
    "awaiting-confirmation",
    "submitted",
    "confirming",
  ].includes(transaction.stage);
  const hasEvmWallet = Boolean(
    walletClient.data && walletClientAddress && ownerAddress && !signerAddressMismatch,
  );
  const isCorrectNetwork = activeChainId === monadTestnet.id;

  async function handleSwitchNetwork() {
    try {
      await switchChain.switchChainAsync({ chainId: monadTestnet.id });
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isUserRejectedError(error) ? "rejected" : "rpc-error",
        message: isUserRejectedError(error)
          ? "The network switch was rejected in your wallet."
          : "The wallet could not switch to Monad Testnet.",
        technical: explained.technical,
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setTransaction({ stage: "validating" });
    const valid = await form.trigger();
    if (!valid) {
      setTransaction({
        stage: "validation-error",
        message: "Review the highlighted fields before continuing.",
      });
      return;
    }
    if (signerAddressMismatch) {
      setTransaction({
        stage: "validation-error",
        message:
          "Your connected account and signing wallet are out of sync. Reconnect your wallet before submitting.",
      });
      return;
    }
    if (!authenticated || !hasEvmWallet || !ownerAddress || !walletClient.data) {
      setTransaction({
        stage: "rpc-error",
        message: "Connect an active EVM wallet before creating an agreement.",
      });
      return;
    }
    if (!isCorrectNetwork) {
      setTransaction({
        stage: "rpc-error",
        message: "Switch to Monad Testnet before submitting this agreement.",
      });
      return;
    }
    if (!publicClient) {
      setTransaction({
        stage: "rpc-error",
        message: "The Monad Testnet RPC client is unavailable. Try again shortly.",
      });
      return;
    }

    const parsedValues = schema.safeParse(form.getValues());
    if (!parsedValues.success) {
      setTransaction({
        stage: "validation-error",
        message: "Review the highlighted fields before continuing.",
      });
      return;
    }

    let args: ReturnType<typeof buildCreateAgreementArguments>;
    try {
      args = buildCreateAgreementArguments(parsedValues.data);
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: "validation-error",
        message:
          "The participant addresses or transaction values could not be normalized. Review the form and try again.",
        technical: explained.technical,
      });
      return;
    }

    let request;
    try {
      const simulation = await publicClient.simulateContract({
        account: ownerAddress,
        address: returnBondContract.address,
        abi: returnBondContract.abi,
        functionName: "createAgreement",
        args,
      });
      request = simulation.request;
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isRpcError(error) ? "rpc-error" : "simulation-error",
        message: explained.message,
        technical: explained.technical,
      });
      return;
    }

    let hash: Hash;
    setTransaction({ stage: "awaiting-confirmation" });
    try {
      hash = await walletClient.data.writeContract(request);
      setTransaction({ stage: "submitted", hash });
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: isUserRejectedError(error) ? "rejected" : "rpc-error",
        message: isUserRejectedError(error)
          ? "You rejected the transaction in your wallet. Nothing was submitted."
          : "The wallet or RPC could not submit the transaction.",
        technical: explained.technical,
      });
      return;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    setTransaction({ stage: "confirming", hash });
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The transaction receipt reports a reverted transaction.");
      }

      let agreementId: bigint | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== returnBondContract.address.toLowerCase()) {
          continue;
        }
        try {
          const decoded = decodeEventLog({
            abi: returnBondContract.abi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "AgreementCreated") {
            agreementId = decoded.args.agreementId;
            break;
          }
        } catch {
          // The receipt may contain unrelated logs; only AgreementCreated is relevant.
        }
      }

      if (agreementId === undefined) {
        throw new Error(
          "The confirmed receipt did not contain the expected AgreementCreated event.",
        );
      }

      setTransaction({ stage: "confirmed", hash });
      router.push(`/agreements/${agreementId.toString()}`);
    } catch (error) {
      const explained = explainContractError(error);
      setTransaction({
        stage: "rpc-error",
        hash,
        message:
          "The transaction was submitted, but its successful agreement event could not be confirmed.",
        technical: explained.technical,
      });
    }
  }

  if (!ready) {
    return (
      <main className="dashboard-main site-shell" aria-busy="true">
        <div className="auth-loading">
          <span className="loading-mark" aria-hidden="true" />
          <p>Checking your ReturnBond session…</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="dashboard-main site-shell">
        <section className="signin-sheet" aria-labelledby="create-signin-title">
          <div className="signin-icon" aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">Owner authorization</p>
          <h1 id="create-signin-title">Sign in to create an agreement.</h1>
          <p>
            Your active EVM wallet becomes the onchain owner. ReturnBond never asks
            for your private key.
          </p>
          <button className="button button-primary button-large" type="button" onClick={login}>
            <LogIn aria-hidden="true" size={18} />
            Sign in to continue
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="create-main site-shell">
      <div className="create-layout">
        <section className="agreement-form-sheet" aria-labelledby="create-title">
          <div className="form-heading">
            <div>
              <p className="eyebrow">New onchain record</p>
              <h1 id="create-title">Create an agreement</h1>
              <p>
                Define the people, item, deposit, and deadlines. Your wallet will
                show the final contract request before anything is sent.
              </p>
            </div>
            <span className="form-step">01 / Create</span>
          </div>

          {signerAddressMismatch ? (
            <div className="inline-alert" role="alert">
              <CircleAlert aria-hidden="true" size={19} />
              <p>
                Your connected account and signing wallet are out of sync.
                Reconnect your wallet before creating an agreement.
              </p>
            </div>
          ) : !hasEvmWallet ? (
            <div className="inline-alert" role="alert">
              <WalletCards aria-hidden="true" size={19} />
              <p>An active EVM wallet is required to create an agreement.</p>
            </div>
          ) : null}

          {hasEvmWallet && !isCorrectNetwork && (
            <div className="network-alert" role="alert">
              <CircleAlert aria-hidden="true" size={20} />
              <div>
                <strong>Wrong network</strong>
                <p>Creating agreements requires Monad Testnet (chain ID 10143).</p>
              </div>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void handleSwitchNetwork()}
                disabled={switchChain.isPending}
              >
                {switchChain.isPending ? "Switching…" : "Switch to Monad Testnet"}
              </button>
            </div>
          )}

          <form className="agreement-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
            <fieldset disabled={isPending}>
              <legend>Item and participants</legend>
              <div className="form-field">
                <label htmlFor="itemName">Item name</label>
                <p id="itemName-help">Use a clear name both people will recognize.</p>
                <input
                  id="itemName"
                  type="text"
                  autoComplete="off"
                  aria-describedby={`itemName-help${errors.itemName ? " itemName-error" : ""}`}
                  aria-invalid={Boolean(errors.itemName)}
                  {...form.register("itemName")}
                />
                <span id="itemName-error"><FieldError message={errors.itemName?.message} /></span>
              </div>

              <div className="form-field">
                <label htmlFor="itemMetadataURI">Item metadata URI</label>
                <p id="itemMetadataURI-help">A real accessible HTTPS, HTTP, or IPFS URI. Uploads are not included yet.</p>
                <input
                  id="itemMetadataURI"
                  type="url"
                  inputMode="url"
                  placeholder="https://… or ipfs://…"
                  autoComplete="url"
                  aria-describedby={`itemMetadataURI-help${errors.itemMetadataURI ? " itemMetadataURI-error" : ""}`}
                  aria-invalid={Boolean(errors.itemMetadataURI)}
                  {...form.register("itemMetadataURI")}
                />
                <span id="itemMetadataURI-error"><FieldError message={errors.itemMetadataURI?.message} /></span>
              </div>

              <div className="form-field">
                <label htmlFor="borrower">Borrower EVM address</label>
                <p id="borrower-help">The wallet that will later fund the deposit.</p>
                <input
                  id="borrower"
                  type="text"
                  inputMode="text"
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`borrower-help${errors.borrower ? " borrower-error" : ""}`}
                  aria-invalid={Boolean(errors.borrower)}
                  {...form.register("borrower")}
                />
                <span id="borrower-error"><FieldError message={errors.borrower?.message} /></span>
              </div>

              <div className="form-field">
                <label htmlFor="arbiter">Neutral arbiter EVM address</label>
                <p id="arbiter-help">A different wallet trusted by both people.</p>
                <input
                  id="arbiter"
                  type="text"
                  inputMode="text"
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`arbiter-help${errors.arbiter ? " arbiter-error" : ""}`}
                  aria-invalid={Boolean(errors.arbiter)}
                  {...form.register("arbiter")}
                />
                <span id="arbiter-error"><FieldError message={errors.arbiter?.message} /></span>
              </div>
            </fieldset>

            <fieldset disabled={isPending}>
              <legend>Deposit and timing</legend>
              <div className="form-field">
                <label htmlFor="depositAmount">Security deposit</label>
                <p id="depositAmount-help">MON amount recorded now and funded by the borrower later.</p>
                <div className="input-suffix">
                  <input
                    id="depositAmount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    aria-describedby={`depositAmount-help${errors.depositAmount ? " depositAmount-error" : ""}`}
                    aria-invalid={Boolean(errors.depositAmount)}
                    {...form.register("depositAmount")}
                  />
                  <span>MON</span>
                </div>
                <span id="depositAmount-error"><FieldError message={errors.depositAmount?.message} /></span>
              </div>

              <div className="timezone-note">
                <Clock3 aria-hidden="true" size={18} />
                <p>Date and time entries use your local timezone and are converted deterministically to Unix seconds.</p>
              </div>

              <div className="form-two-column">
                <div className="form-field">
                  <label htmlFor="handoverDeadline">Handover deadline</label>
                  <input
                    id="handoverDeadline"
                    type="datetime-local"
                    aria-invalid={Boolean(errors.handoverDeadline)}
                    {...form.register("handoverDeadline")}
                  />
                  <FieldError message={errors.handoverDeadline?.message} />
                </div>
                <div className="form-field">
                  <label htmlFor="returnDeadline">Return deadline</label>
                  <input
                    id="returnDeadline"
                    type="datetime-local"
                    aria-invalid={Boolean(errors.returnDeadline)}
                    {...form.register("returnDeadline")}
                  />
                  <FieldError message={errors.returnDeadline?.message} />
                </div>
              </div>

              <div className="form-two-column">
                <div className="form-field">
                  <label htmlFor="inspectionPeriod">Inspection period</label>
                  <div className="period-input">
                    <input
                      id="inspectionPeriod"
                      type="text"
                      inputMode="numeric"
                      aria-invalid={Boolean(errors.inspectionPeriod)}
                      {...form.register("inspectionPeriod")}
                    />
                    <select aria-label="Inspection period unit" {...form.register("inspectionUnit")}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                  <FieldError message={errors.inspectionPeriod?.message} />
                </div>
                <div className="form-field">
                  <label htmlFor="claimResponsePeriod">Claim response period</label>
                  <div className="period-input">
                    <input
                      id="claimResponsePeriod"
                      type="text"
                      inputMode="numeric"
                      aria-invalid={Boolean(errors.claimResponsePeriod)}
                      {...form.register("claimResponsePeriod")}
                    />
                    <select aria-label="Claim response period unit" {...form.register("claimResponseUnit")}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                  <FieldError message={errors.claimResponsePeriod?.message} />
                </div>
              </div>
            </fieldset>

            <TransactionStatus state={transaction} />

            <button
              className="button button-primary create-submit"
              type="submit"
              disabled={isPending || !hasEvmWallet || !isCorrectNetwork}
            >
              {isPending && <LoaderCircle className="spin" aria-hidden="true" size={18} />}
              {transaction.stage === "awaiting-confirmation"
                ? "Confirm in wallet"
                : transaction.stage === "confirming" || transaction.stage === "submitted"
                  ? "Confirming onchain"
                  : "Review and create agreement"}
            </button>
          </form>
        </section>

        <aside className="create-receipt" aria-labelledby="receipt-title">
          <p className="eyebrow">Before you sign</p>
          <h2 id="receipt-title">One onchain action</h2>
          <ol>
            <li><span>1</span><div><strong>Validate</strong><p>Check every role, amount, and deadline.</p></div></li>
            <li><span>2</span><div><strong>Simulate</strong><p>Ask Monad Testnet whether the contract call would succeed.</p></div></li>
            <li><span>3</span><div><strong>Confirm</strong><p>Your wallet submits only after your explicit approval.</p></div></li>
          </ol>
          <div className="receipt-rule" />
          <p className="receipt-note">No deposit is transferred during creation. The recorded borrower funds it later through the live agreement.</p>
        </aside>
      </div>
    </main>
  );
}
