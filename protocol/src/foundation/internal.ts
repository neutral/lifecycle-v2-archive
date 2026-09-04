import { z } from "zod/v4";
import { FoundationProtocolError } from "../protocol-error.js";

export type FoundationDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly FoundationDeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: FoundationDeepReadonly<T[Key]> }
      : T;

export const FoundationTargetSchema = z.string().min(1).max(4_096)
  .refine((value) => !value.includes("\u0000"));
export const FoundationPlainTextSchema = z.string().min(1).max(16_384)
  .refine((value) => !value.includes("\u0000"));
export const FoundationPositiveSafeIntegerSchema =
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const FoundationNonnegativeSafeIntegerSchema =
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export function protocolParse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: string,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new FoundationProtocolError(
      code,
      `${label} violates the Foundation interface protocol${issue === undefined ? "" : `: ${issue.message}`}`,
      issue?.path.map((entry) =>
        typeof entry === "symbol" ? entry.description ?? "<symbol>" : entry) ?? [],
    );
  }
  return parsed.data;
}
