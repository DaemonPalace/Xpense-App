import { describe, expect, it } from "vitest";
import { aggregate } from "../../src/lib/aggregate";

describe("aggregate", () => {
  it("sums per month/category/type with refunds reducing totals", () => {
    const m = aggregate([
      { date: "2026-09-01", amountMinor: 1000, type: "expense", category: "food" },
      { date: "2026-09-15", amountMinor: 2500, type: "expense", category: "food" },
      { date: "2026-09-20", amountMinor: -500, type: "expense", category: "food" },
      { date: "2026-09-20", amountMinor: 30000, type: "savings", category: "savings" },
      { date: "2026-10-02", amountMinor: 999, type: "expense", category: "transport" },
    ]);
    expect(m.get("2026-09")).toEqual({
      month: "2026-09",
      totals: { food: { expenseMinor: 3000, savingsMinor: 0, count: 3 }, savings: { expenseMinor: 0, savingsMinor: 30000, count: 1 } },
      expenseMinor: 3000,
      savingsMinor: 30000,
    });
    expect(m.get("2026-10")?.expenseMinor).toBe(999);
  });
});
