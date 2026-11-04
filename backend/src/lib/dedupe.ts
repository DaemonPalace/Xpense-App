import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const normalizeDescription = (d: string) => d.toLowerCase().replace(/\s+/g, " ").trim();

export function syncFingerprint(accountId: string, externalId: string): string {
  return sha256(`${accountId}|${externalId}`);
}

/** occurrenceIndex keeps identical legitimate rows in one file distinct (research R9). */
export function csvFingerprint(accountId: string, date: string, amountMinor: number, description: string, occurrenceIndex: number): string {
  return sha256(`${accountId}|${date}|${amountMinor}|${normalizeDescription(description)}|${occurrenceIndex}`);
}
