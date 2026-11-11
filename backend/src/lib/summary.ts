/** Safe-to-spend math (requirements.md F4). Pure: amounts in minor units, dates as YYYY-MM-DD in the user's zone. */

/** `month` (YYYY-MM) = one-off income for that month only; absent = received every month. */
export interface Income { amountMinor: number; month?: string | null }
export interface Goal { targetMinor: number; monthly: boolean; targetDate?: string | null }
export interface Txn { date: string; amountMinor: number; type: string; category?: string }

export interface Summary {
  month: string;
  daysLeft: number;
  inflowsMinor: number;
  /** Inflows that repeat every month (excludes this month's one-off incomes); used for projections. */
  recurringInflowsMinor: number;
  savingsGoalMinor: number;
  savedMinor: number;
  allowedMinor: number;
  spentMinor: number;
  spentTodayMinor: number;
  remainingMinor: number;
  dailyLimitMinor: number;
  safeToSpendTodayMinor: number;
  pctUsed: number;
  status: "ok" | "warning" | "over";
  /** Expense per category this month (dashboard). */
  byCategoryMinor: Record<string, number>;
  /** Expense per day of the month, index 0 = day 1 (weekly cumulative chart). */
  dailyMinor: number[];
}

// ponytail: one zone for every user (MVP targets La Sabana). Add a profile timezone when users are elsewhere.
export const TIME_ZONE = "America/Bogota";
export const localToday = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** What a goal asks to save this month: monthly goals in full, dated goals split evenly over the months left. */
export function monthlyContribution(goal: Goal, today: string): number {
  if (goal.monthly) return goal.targetMinor;
  if (!goal.targetDate || goal.targetDate < today) return 0;
  const months = monthIndex(goal.targetDate) - monthIndex(today) + 1;
  return Math.ceil(goal.targetMinor / months);
}

export function summarize(today: string, incomes: Income[], goals: Goal[], txns: Txn[]): Summary {
  const month = today.slice(0, 7);
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysLeft = daysInMonth - d + 1; // today counts

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const inMonth = txns.filter((t) => t.date.startsWith(month));
  const expenses = inMonth.filter((t) => t.type === "expense");
  const recurringInflowsMinor = sum(incomes.filter((i) => !i.month).map((i) => i.amountMinor));
  const inflowsMinor = recurringInflowsMinor + sum(incomes.filter((i) => i.month === month).map((i) => i.amountMinor));
  const savingsGoalMinor = sum(goals.map((g) => monthlyContribution(g, today)));
  const savedMinor = sum(inMonth.filter((t) => t.type === "savings").map((t) => t.amountMinor));
  const spentMinor = sum(expenses.map((t) => t.amountMinor));
  const spentTodayMinor = sum(expenses.filter((t) => t.date === today).map((t) => t.amountMinor));

  // Saving more than the goal also leaves less to spend, so reserve whichever is larger.
  const reserved = Math.max(savingsGoalMinor, savedMinor);
  const allowedMinor = inflowsMinor - savingsGoalMinor;
  const remainingMinor = inflowsMinor - reserved - spentMinor;
  // Limit fixed at the start of the day, so spending today lowers "safe to spend" instead of re-spreading it.
  const dailyLimitMinor = Math.floor((remainingMinor + spentTodayMinor) / daysLeft);
  const safeToSpendTodayMinor = dailyLimitMinor - spentTodayMinor;
  const pctUsed = allowedMinor > 0 ? Math.round((spentMinor * 100) / allowedMinor) : spentMinor > 0 ? 100 : 0;
  const status = remainingMinor < 0 ? "over" : pctUsed >= 80 || safeToSpendTodayMinor < 0 ? "warning" : "ok";

  const byCategoryMinor: Record<string, number> = {};
  const dailyMinor = new Array<number>(daysInMonth).fill(0);
  for (const t of expenses) {
    const c = t.category ?? "other";
    byCategoryMinor[c] = (byCategoryMinor[c] ?? 0) + t.amountMinor;
    dailyMinor[Number(t.date.slice(8, 10)) - 1] += t.amountMinor;
  }

  return { month, daysLeft, inflowsMinor, recurringInflowsMinor, savingsGoalMinor, savedMinor, allowedMinor, spentMinor, spentTodayMinor, remainingMinor, dailyLimitMinor, safeToSpendTodayMinor, pctUsed, status, byCategoryMinor, dailyMinor };
}
