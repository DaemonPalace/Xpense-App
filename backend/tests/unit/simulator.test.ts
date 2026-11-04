import { describe, expect, it } from "vitest";
import { firstSyncStart, generate } from "../../src/lib/simulator";

describe("simulator", () => {
  it("is deterministic per account", () => {
    expect(generate("acc1", "checking", "2026-09-01", "2026-09-30")).toEqual(generate("acc1", "checking", "2026-09-01", "2026-09-30"));
    expect(generate("acc1", "checking", "2026-09-01", "2026-09-30")).not.toEqual(generate("acc2", "checking", "2026-09-01", "2026-09-30"));
  });
  it("first sync covers 6 complete months", () => {
    expect(firstSyncStart("2026-10-24")).toBe("2026-04-01");
    const rows = generate("acc1", "checking", firstSyncStart("2026-10-24"), "2026-10-24");
    expect(new Set(rows.map((r) => r.date.slice(0, 7))).size).toBe(7);
  });
  it("incremental sync yields only the requested days, identical to the full run", () => {
    const full = generate("acc1", "credit_card", "2026-09-01", "2026-10-10");
    const inc = generate("acc1", "credit_card", "2026-10-05", "2026-10-10");
    expect(inc.every((r) => r.date >= "2026-10-05")).toBe(true);
    expect(full.filter((r) => r.date >= "2026-10-05")).toEqual(inc);
  });
  it("amounts are positive integers", () => {
    for (const r of generate("acc1", "savings", "2026-01-01", "2026-03-31")) expect(Number.isInteger(r.amountMinor) && r.amountMinor > 0).toBe(true);
  });
});
