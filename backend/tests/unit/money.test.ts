import { describe, expect, it } from "vitest";
import { parseAmount, validateAmount } from "../../src/lib/money";

describe("money", () => {
  it("parses decimal strings to integer minor units", () => {
    expect(parseAmount("12.34")).toBe(1234);
    expect(parseAmount("-0.5")).toBe(-50);
    expect(parseAmount("7")).toBe(700);
    expect(parseAmount("0.1") + parseAmount("0.2")).toBe(30);
  });
  it("rejects bad input", () => {
    expect(() => parseAmount("1.234")).toThrow();
    expect(() => parseAmount("abc")).toThrow();
    expect(() => parseAmount("")).toThrow();
  });
  it("validates range", () => {
    expect(validateAmount(0)).not.toBeNull();
    expect(validateAmount(100_000_000_001)).not.toBeNull();
    expect(validateAmount(-100_000_000_000)).toBeNull();
    expect(validateAmount(1.5)).not.toBeNull();
  });
});
