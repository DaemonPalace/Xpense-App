import { ulid } from "ulid";
import { validateAmount } from "./money";
import { txnSk, userPk, type Item } from "./db";

export const CATEGORIES = ["housing", "food", "transport", "utilities", "entertainment", "health", "shopping", "savings", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type TxnType = "expense" | "savings";
export type Origin = "manual" | "sync" | "csv";

export interface TransactionInput {
  date: string;
  amountMinor: number;
  type: TxnType;
  category: Category;
  description: string;
  accountId?: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function validateDate(date: unknown, now = new Date()): string | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "date must be YYYY-MM-DD";
  const d = new Date(date + "T00:00:00Z");
  if (isNaN(d.getTime()) || isoDay(d) !== date) return "date is not a valid calendar date";
  // allow +1 day for user time zones ahead of UTC
  if (date > isoDay(new Date(now.getTime() + 86_400_000))) return "date must not be in the future";
  return null;
}

export function validateTransactionInput(input: any, now = new Date()): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== "object") return { body: "body must be an object" };
  const dateErr = validateDate(input.date, now);
  if (dateErr) errors.date = dateErr;
  const amtErr = validateAmount(input.amountMinor);
  if (amtErr) errors.amountMinor = amtErr;
  if (input.type !== "expense" && input.type !== "savings") errors.type = "type must be expense or savings";
  if (!CATEGORIES.includes(input.category)) errors.category = `category must be one of ${CATEGORIES.join(", ")}`;
  if (typeof input.description !== "string" || input.description.trim().length < 1 || input.description.length > 200)
    errors.description = "description must be 1–200 chars";
  if (input.accountId != null && typeof input.accountId !== "string") errors.accountId = "accountId must be a string";
  return errors;
}

export function toItem(sub: string, input: TransactionInput, origin: Origin, correlationId: string, extra: { txnId?: string; jobId?: string; fingerprint?: string; createdAt?: string } = {}): Item {
  const now = new Date().toISOString();
  const txnId = extra.txnId ?? ulid();
  return {
    PK: userPk(sub),
    SK: txnSk(input.date, txnId),
    txnId,
    date: input.date,
    amountMinor: input.amountMinor,
    type: input.type,
    category: input.category,
    description: input.description.trim(),
    accountId: input.accountId ?? null,
    origin,
    fingerprint: extra.fingerprint ?? null,
    jobId: extra.jobId ?? null,
    lastCorrelationId: correlationId,
    createdAt: extra.createdAt ?? now,
    updatedAt: now,
  };
}

export function toDto(item: Item) {
  const { PK, SK, lastCorrelationId, fingerprint, jobId, ...dto } = item;
  return dto;
}
