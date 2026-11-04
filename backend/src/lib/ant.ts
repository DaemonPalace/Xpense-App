/** Ant expenses ("gastos hormiga", FR-9.2): small purchases that repeat ≥ 3 times within 7 days in one category. */

export const DEFAULT_ANT_THRESHOLD_MINOR = 15_000 * 100; // COP 15,000
const MIN_REPEATS = 3;
const WINDOW_DAYS = 7;

export interface AntTxn {
  txnId: string;
  date: string;
  amountMinor: number;
  type: string;
  category: string;
}

const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / 86_400_000;

// ponytail: callers pass one month, so a streak that starts in the last days of the previous month is missed. Pass 6 more days if that matters.
export function antExpenses(txns: AntTxn[], thresholdMinor = DEFAULT_ANT_THRESHOLD_MINOR) {
  const small = txns.filter((t) => t.type === "expense" && t.amountMinor > 0 && t.amountMinor < thresholdMinor);
  const byCategory = new Map<string, AntTxn[]>();
  for (const t of small) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);

  const ids = new Set<string>();
  for (const group of byCategory.values()) {
    group.sort((a, b) => (a.date < b.date ? -1 : 1));
    // Sliding window: whenever ≥ 3 purchases fit inside 7 days, every one of them is an ant expense.
    let j = 0;
    for (let i = 0; i < group.length; i++) {
      while (dayNumber(group[i].date) - dayNumber(group[j].date) >= WINDOW_DAYS) j++;
      if (i - j + 1 >= MIN_REPEATS) for (let k = j; k <= i; k++) ids.add(group[k].txnId);
    }
  }

  const flagged = small.filter((t) => ids.has(t.txnId));
  const totals: Record<string, { count: number; totalMinor: number }> = {};
  for (const t of flagged) {
    const c = (totals[t.category] ??= { count: 0, totalMinor: 0 });
    c.count++;
    c.totalMinor += t.amountMinor;
  }
  return { ids: [...ids], count: flagged.length, totalMinor: flagged.reduce((a, t) => a + t.amountMinor, 0), byCategory: totals };
}
