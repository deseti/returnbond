const RETURNBOND_ERROR_MESSAGES: Record<string, string> = {
  ZeroAddress: "Borrower and arbiter addresses cannot be the zero address.",
  RolesMustBeDistinct: "Owner, borrower, and arbiter must use different addresses.",
  ZeroDeposit: "The security deposit must be greater than zero.",
  InvalidHandoverDeadline: "The handover deadline must still be in the future.",
  InvalidReturnDeadline: "The return deadline must be later than the handover deadline.",
  ZeroInspectionPeriod: "The inspection period must be greater than zero.",
  ZeroClaimResponsePeriod: "The claim response period must be greater than zero.",
  EmptyItemName: "Enter an item name.",
  EmptyMetadataURI: "Enter a metadata URI.",
  EmptyReturnProofURI: "Enter a return-proof URI.",
  Unauthorized: "The connected wallet is not authorized for this agreement action.",
  InvalidStatus: "The agreement state changed and this action is no longer available.",
  IncorrectDeposit: "The transaction value must exactly match the recorded deposit.",
  DeadlineExpired: "The contract action deadline has already been reached.",
  DeadlineNotReached: "The contract action deadline has not been reached yet.",
  NativeTransferFailed: "The contract could not return the deposit to the borrower wallet.",
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isUserRejectedError(error: unknown): boolean {
  const text = errorText(error);
  return /user rejected|user denied|rejected the request|ACTION_REJECTED/i.test(text);
}

export function isRpcError(error: unknown): boolean {
  return /HTTP request failed|RPC request failed|timed? out|network error|fetch failed|failed to fetch|socket|ECONN/i.test(
    errorText(error),
  );
}

export function explainContractError(error: unknown): {
  message: string;
  technical: string;
} {
  const text = errorText(error);
  const customError = Object.entries(RETURNBOND_ERROR_MESSAGES).find(([name]) =>
    text.includes(name),
  );

  const shortMessage =
    typeof error === "object" &&
    error !== null &&
    "shortMessage" in error &&
    typeof error.shortMessage === "string"
      ? error.shortMessage
      : text.split("\n")[0];

  return {
    message:
      customError?.[1] ??
      "The contract request could not be completed. Review the details and try again.",
    technical: shortMessage || "Unknown contract client error",
  };
}
