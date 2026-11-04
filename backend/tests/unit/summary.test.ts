import { describe, expect, it } from "vitest";
import { localToday, monthlyContribution, summarize } from "../../src/lib/summary";

const COP = (pesos: number) => pesos * 100;
const income = [{ amountMinor: COP(1_000_000) }];
const goal = [{ targetMinor: COP(200_000), monthly: true }];
const exp = (date: string, pesos: number) => ({ date, amountMinor: COP(pesos), type: "expense" });

describe("summarize (FR-4)", () => {
  it("fresh month: allowed spend spread over every day", () => {
    const s = summarize("2026-11-01", income, goal, []);
    expect(s).toMatchObject({ daysLeft: 30, allowedMinor: COP(800_000), remainingMinor: COP(800_000), status: "ok" });
    expect(s.dailyLimitMinor).toBe(Math.floor(COP(800_000) / 30));
    expect(s.safeToSpendTodayMinor).toBe(s.dailyLimitMinor);
  });

  it("spending today lowers today's safe amount, not the daily limit", () => {
    const s = summarize("2026-11-21", income, goal, [exp("2026-11-03", 400_000), exp("2026-11-21", 15_000)]);
    // 400,000 left at start of day 21, 10 days left
    expect(s.dailyLimitMinor).toBe(COP(40_000));
    expect(s.safeToSpendTodayMinor).toBe(COP(25_000));
    expect(s.pctUsed).toBe(52);
    expect(s.status).toBe("ok");
  });

  it("ignores other months and refunds reduce spend", () => {
    const s = summarize("2026-11-10", income, goal, [exp("2026-10-30", 900_000), exp("2026-11-05", 100_000), exp("2026-11-06", -20_000)]);
    expect(s.spentMinor).toBe(COP(80_000));
  });

  it("warning at 80% and when today's spend beats the limit; over when the goal is eaten", () => {
    expect(summarize("2026-11-20", income, goal, [exp("2026-11-02", 650_000)]).status).toBe("warning");
    expect(summarize("2026-11-02", income, goal, [exp("2026-11-02", 50_000)]).status).toBe("warning");
    const over = summarize("2026-11-25", income, goal, [exp("2026-11-02", 850_000)]);
    expect(over.status).toBe("over");
    expect(over.remainingMinor).toBe(COP(-50_000));
    expect(over.safeToSpendTodayMinor).toBeLessThan(0);
  });

  it("saving above the goal reserves the extra; no income means everything is over", () => {
    const s = summarize("2026-11-01", income, goal, [{ date: "2026-11-01", amountMinor: COP(300_000), type: "savings" }]);
    expect(s.remainingMinor).toBe(COP(700_000));
    expect(summarize("2026-11-01", [], [], [exp("2026-11-01", 1)])).toMatchObject({ pctUsed: 100, status: "over" });
  });

  it("dated goals split over the months left, past goals ask nothing", () => {
    expect(monthlyContribution({ targetMinor: 300, monthly: false, targetDate: "2027-01-15" }, "2026-11-04")).toBe(100);
    expect(monthlyContribution({ targetMinor: 300, monthly: false, targetDate: "2026-11-30" }, "2026-11-04")).toBe(300);
    expect(monthlyContribution({ targetMinor: 300, monthly: false, targetDate: "2026-10-01" }, "2026-11-04")).toBe(0);
  });

  it("breaks spend down by category and day", () => {
    const s = summarize("2026-11-10", income, goal, [
      { date: "2026-11-02", amountMinor: 500, type: "expense", category: "snacks" },
      { date: "2026-11-02", amountMinor: 300, type: "expense", category: "food" },
      { date: "2026-11-09", amountMinor: 200, type: "expense", category: "snacks" },
      { date: "2026-11-09", amountMinor: 999, type: "savings", category: "savings" },
    ]);
    expect(s.byCategoryMinor).toEqual({ snacks: 700, food: 300 });
    expect(s.dailyMinor).toHaveLength(30);
    expect([s.dailyMinor[1], s.dailyMinor[8]]).toEqual([800, 200]);
  });

  it("local day is Bogotá (UTC-5)", () => {
    expect(localToday(new Date("2026-11-05T03:00:00Z"))).toBe("2026-11-04");
  });
});
