import { describe, expect, it } from "vitest";
import { dueAlerts } from "../../src/lib/alerts";
import { summarize } from "../../src/lib/summary";

const COP = (p: number) => p * 100;
const income = [{ amountMinor: COP(1_000_000) }];
const goal = [{ targetMinor: COP(200_000), monthly: true }];
const exp = (date: string, pesos: number) => ({ date, amountMinor: COP(pesos), type: "expense" });
const kinds = (today: string, txns: any[]) => dueAlerts(summarize(today, income, goal, txns), today).map((a) => a.sk);

describe("dueAlerts (FR-10)", () => {
  it("nothing below 80% and under the daily limit", () => {
    expect(kinds("2026-11-10", [exp("2026-11-02", 100_000)])).toEqual([]);
  });
  it("80%, then 100% replaces it; keys are per month", () => {
    expect(kinds("2026-11-25", [exp("2026-11-02", 650_000)])).toEqual(["ALERT#2026-11#pct80"]);
    expect(kinds("2026-11-25", [exp("2026-11-02", 800_000)])).toContain("ALERT#2026-11#pct100");
  });
  it("daily alert keyed by day", () => {
    expect(kinds("2026-11-02", [exp("2026-11-02", 50_000)])).toEqual(["ALERT#2026-11#daily#2026-11-02"]);
  });
  it("no alerts before onboarding", () => {
    expect(dueAlerts(summarize("2026-11-02", [], [], [exp("2026-11-02", 5)]), "2026-11-02")).toEqual([]);
  });
  it("messages are Spanish with COP amounts", () => {
    const [a] = dueAlerts(summarize("2026-11-25", income, goal, [exp("2026-11-02", 650_000)]), "2026-11-25");
    expect(a.body).toMatch(/\$\s?150\.000/);
  });
});
