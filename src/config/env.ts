import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
    message: "must be an HTTP or HTTPS URL",
  });

const publicEnvSchema = z.object({
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().trim().min(1),
  NEXT_PUBLIC_MONAD_RPC_URL: httpUrlSchema,
  NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS: z
    .string()
    .trim()
    .refine(isAddress, { message: "must be a valid EVM address" })
    .transform((value) => getAddress(value) as Address),
});

const parsedPublicEnv = publicEnvSchema.safeParse({
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_MONAD_RPC_URL: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
  NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS:
    process.env.NEXT_PUBLIC_RETURNBOND_CONTRACT_ADDRESS,
});

if (!parsedPublicEnv.success) {
  const invalidVariables = parsedPublicEnv.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");

  throw new Error(
    `Invalid public environment configuration. Check: ${invalidVariables}`,
  );
}

export const publicEnv = parsedPublicEnv.data;

