export const MAX_ABS_MINOR = 100_000_000;

/** Decimal string → integer minor units without float math. Throws on bad input. */
export function parseAmount(str: string): number {
  const m = /^\s*(-)?(\d+)(?:\.(\d{1,2}))?\s*$/.exec(str);
  if (!m) throw new Error(`Invalid amount: ${str}`);
  const minor = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -minor : minor;
}

export function validateAmount(minor: unknown): string | null {
  if (typeof minor !== "number" || !Number.isInteger(minor)) return "amountMinor must be an integer";
  if (minor === 0) return "amount must not be zero";
  if (Math.abs(minor) > MAX_ABS_MINOR) return "amount too large";
  return null;
}

export function formatAmount(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
