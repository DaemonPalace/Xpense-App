import { describe, expect, it } from "vitest";
import { forecast, predict } from "../../src/lib/forecast";
import type { MonthlyAggregate } from "../../src/lib/aggregate";

const today = new Date("2026-10-24T00:00:00Z");
const agg = (month: string, food: number): MonthlyAggregate => ({
  month,
  totals: { food: { expenseMinor: food, savingsMinor: 0, count: 1 } },
  expenseMinor: food,
  savingsMinor: 0,
});

describe("forecast", () => {
  it("needs 2 complete months", () => {
    expect(forecast([agg("2026-10", 500)], today).status).toBe("insufficient_history");
    expect(forecast([agg("2026-09", 500), agg("2026-10", 500)], today)).toMatchObject({ status: "insufficient_history", historyMonths: 1 });
    expect(forecast([agg("2026-08", 500), agg("2026-09", 500)], today)).toMatchObject({ status: "ok", historyMonths: 2 });
  });

  it("flat history predicts the same amount; 3 months = 3x", () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => agg(m, 1000));
    const f = forecast([...months, agg("2026-10", 99999)], new Date("2026-10-03T00:00:00Z")); // first week: current month excluded
    expect(f).toMatchObject({ status: "ok", historyMonths: 6, overall: { nextMonthMinor: 1000, next3MonthsMinor: 3000 } });
    expect(f.byCategory.food).toEqual({ nextMonthMinor: 1000, next3MonthsMinor: 3000 });
  });

  it("after the first week, this month's pace moves the projection", () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => agg(m, 3100));
    const at = (current: MonthlyAggregate[]) => forecast([...months, ...current], today).overall.nextMonthMinor; // day 24 of 31
    expect(at([agg("2026-10", 2400)])).toBe(3100); // on pace: 2400 × 31/24 = 3100
    expect(at([agg("2026-10", 1200)])).toBe(Math.round((3100 * 21 + 1550 * 7) / 28)); // deleted half: lower
    expect(at([])).toBe(Math.round((3100 * 21) / 28)); // nothing spent this month
    expect(at([agg("2026-10", 99999)])).toBe(Math.round((3100 * 21 + 6200 * 7) / 28)); // spike clamped to median × 2
  });

  it("uses at most 6 months and counts empty months as zero", () => {
    const f = forecast([agg("2025-01", 1000), agg("2026-09", 1000)], today);
    expect(f.historyMonths).toBe(6);
  });

  it("weights newest months heaviest and clamps one-off spikes to median x 2", () => {
    expect(predict([100, 200]).nextMonthMinor).toBe(Math.round((100 * 1 + 200 * 2) / 3));
    // spike 100000 clamped to 2 * median(1000) = 2000
    expect(predict([1000, 1000, 100000]).nextMonthMinor).toBe(Math.round((1000 + 2000 + 2000 * 3) / 6));
  });

  it("returns integers", () => {
    const v = predict([333, 334, 335]);
    expect(Number.isInteger(v.nextMonthMinor)).toBe(true);
  });
});
