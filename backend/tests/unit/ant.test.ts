import { describe, expect, it } from "vitest";
import { antExpenses } from "../../src/lib/ant";

let n = 0;
const tx = (date: string, pesos: number, category = "snacks", type = "expense") => ({ txnId: String(n++), date, amountMinor: pesos * 100, type, category });

describe("antExpenses (FR-9.2)", () => {
  it("flags 3 small purchases in 7 days, all of them", () => {
    const r = antExpenses([tx("2026-11-01", 5000), tx("2026-11-04", 6000), tx("2026-11-07", 4000)]);
    expect(r.count).toBe(3);
    expect(r.totalMinor).toBe(1_500_000);
  });

  it("ignores spread-out, large, refund, savings and mixed-category purchases", () => {
    expect(antExpenses([tx("2026-11-01", 5000), tx("2026-11-08", 5000), tx("2026-11-15", 5000)]).count).toBe(0);
    expect(antExpenses([tx("2026-11-01", 15000), tx("2026-11-02", 20000), tx("2026-11-03", 30000)]).count).toBe(0);
    expect(antExpenses([tx("2026-11-01", -5000), tx("2026-11-02", 5000), tx("2026-11-03", 5000, "snacks", "savings")]).count).toBe(0);
    expect(antExpenses([tx("2026-11-01", 5000, "snacks"), tx("2026-11-02", 5000, "food"), tx("2026-11-03", 5000, "parking")]).count).toBe(0);
  });

  it("extends the streak and totals per category; threshold is adjustable", () => {
    const txns = [tx("2026-11-01", 5000), tx("2026-11-02", 5000), tx("2026-11-03", 5000), tx("2026-11-05", 5000), tx("2026-11-20", 5000)];
    const r = antExpenses(txns);
    expect(r.count).toBe(4);
    expect(r.byCategory.snacks).toEqual({ count: 4, totalMinor: 2_000_000 });
    expect(antExpenses(txns, 4000 * 100).count).toBe(0);
  });
});
