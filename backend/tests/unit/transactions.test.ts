import { describe, expect, it } from "vitest";
import { validateTransactionInput } from "../../src/lib/transactions";

const now = new Date("2026-10-24T12:00:00Z");
const ok = { date: "2026-10-01", amountMinor: 1250, type: "expense", category: "food", description: "Lunch" };

describe("validateTransactionInput", () => {
  it("accepts a valid transaction", () => expect(validateTransactionInput(ok, now)).toEqual({}));
  it("allows tomorrow (time zones) but not later", () => {
    expect(validateTransactionInput({ ...ok, date: "2026-10-25" }, now)).toEqual({});
    expect(validateTransactionInput({ ...ok, date: "2026-10-26" }, now)).toHaveProperty("date");
  });
  it("rejects invalid fields", () => {
    expect(validateTransactionInput({ ...ok, date: "2026-02-30" }, now)).toHaveProperty("date");
    expect(validateTransactionInput({ ...ok, amountMinor: 0 }, now)).toHaveProperty("amountMinor");
    expect(validateTransactionInput({ ...ok, amountMinor: 100_000_001 }, now)).toHaveProperty("amountMinor");
    expect(validateTransactionInput({ ...ok, type: "income" }, now)).toHaveProperty("type");
    expect(validateTransactionInput({ ...ok, category: "travel" }, now)).toHaveProperty("category");
    expect(validateTransactionInput({ ...ok, description: "" }, now)).toHaveProperty("description");
    expect(validateTransactionInput({ ...ok, description: "x".repeat(201) }, now)).toHaveProperty("description");
  });
});
