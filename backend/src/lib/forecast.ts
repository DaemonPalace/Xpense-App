import type { MonthlyAggregate } from "./aggregate";

export interface ForecastValue {
  nextMonthMinor: number;
  next3MonthsMinor: number;
}
export interface ForecastResult {
  status: "ok" | "insufficient_history";
  historyMonths: number;
  overall: ForecastValue;
  byCategory: Record<string, ForecastValue>;
}

export const MAX_HISTORY = 6;
export const MIN_HISTORY = 2;
/** From this day of the month on, the current month's pace joins the series as its newest point. */
export const PACE_MIN_DAYS = 7;

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
function prevMonth(month: string, n = 1): string {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - n);
  return monthKey(d);
}

/** Clamp to median × 2, then linearly weighted moving average (newest heaviest). Research R10. */
export function predict(series: number[]): ForecastValue {
  const sorted = [...series].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const cap = median * 2;
  let num = 0;
  let den = 0;
  series.forEach((v, i) => {
    num += Math.min(v, cap) * (i + 1);
    den += i + 1;
  });
  const next = den ? Math.round(num / den) : 0;
  return { nextMonthMinor: next, next3MonthsMinor: next * 3 };
}

export function forecast(aggregates: Iterable<MonthlyAggregate>, today = new Date()): ForecastResult {
  const byMonth = new Map([...aggregates].map((a) => [a.month, a]));
  const current = monthKey(today);
  const complete = [...byMonth.keys()].filter((m) => m < current).sort();
  const empty: ForecastResult = { status: "insufficient_history", historyMonths: 0, overall: { nextMonthMinor: 0, next3MonthsMinor: 0 }, byCategory: {} };
  if (!complete.length) return empty;

  // window: every calendar month (including empty ones) from first data month, max 6, ending last month
  const window: string[] = [];
  for (let m = prevMonth(current); m >= complete[0] && window.length < MAX_HISTORY; m = prevMonth(m)) window.unshift(m);
  if (window.length < MIN_HISTORY) return { ...empty, historyMonths: window.length };

  // "Si sigues así": the month in progress counts too, extrapolated to a full month, so adding or deleting
  // this month's expenses moves the projection. predict() still clamps it to median × 2.
  // ponytail: linear pace over-weights early fixed costs (rent on day 1); skip the first week, and switch to
  // per-category seasonality if that still misleads.
  const day = today.getUTCDate();
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const months = day >= PACE_MIN_DAYS ? [...window, current] : window;
  const series = (pick: (a?: MonthlyAggregate) => number) =>
    months.map((m) => (m === current ? Math.round((pick(byMonth.get(m)) * daysInMonth) / day) : pick(byMonth.get(m))));

  const categories = new Set(months.flatMap((m) => Object.keys(byMonth.get(m)?.totals ?? {})));
  const byCategory: Record<string, ForecastValue> = {};
  for (const c of categories) {
    const s = series((a) => a?.totals[c]?.expenseMinor ?? 0);
    if (s.some((v) => v !== 0)) byCategory[c] = predict(s);
  }
  return {
    status: "ok",
    historyMonths: window.length,
    overall: predict(series((a) => a?.expenseMinor ?? 0)),
    byCategory,
  };
}
