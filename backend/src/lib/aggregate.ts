import type { Item } from "./db";

export interface CategoryTotal {
  expenseMinor: number;
  savingsMinor: number;
  count: number;
}
export interface MonthlyAggregate {
  month: string;
  totals: Record<string, CategoryTotal>;
  expenseMinor: number;
  savingsMinor: number;
}

export function aggregate(transactions: Pick<Item, "date" | "amountMinor" | "type" | "category">[]): Map<string, MonthlyAggregate> {
  const months = new Map<string, MonthlyAggregate>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    let m = months.get(month);
    if (!m) months.set(month, (m = { month, totals: {}, expenseMinor: 0, savingsMinor: 0 }));
    const c = (m.totals[t.category] ??= { expenseMinor: 0, savingsMinor: 0, count: 0 });
    c.count++;
    if (t.type === "savings") (c.savingsMinor += t.amountMinor), (m.savingsMinor += t.amountMinor);
    else (c.expenseMinor += t.amountMinor), (m.expenseMinor += t.amountMinor);
  }
  return months;
}
