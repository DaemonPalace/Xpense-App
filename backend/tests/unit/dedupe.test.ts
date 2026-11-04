import { describe, expect, it } from "vitest";
import { csvFingerprint, syncFingerprint } from "../../src/lib/dedupe";

describe("dedupe", () => {
  it("is stable for the same sync row", () => expect(syncFingerprint("acc", "2026-10-01-0")).toBe(syncFingerprint("acc", "2026-10-01-0")));
  it("distinguishes identical CSV rows by occurrence", () =>
    expect(csvFingerprint("acc", "2026-10-01", 500, "Coffee", 0)).not.toBe(csvFingerprint("acc", "2026-10-01", 500, "Coffee", 1)));
  it("is stable across re-imports and whitespace/case", () =>
    expect(csvFingerprint("acc", "2026-10-01", 500, "  COFFEE   shop", 0)).toBe(csvFingerprint("acc", "2026-10-01", 500, "coffee shop", 0)));
  it("differs per account", () => expect(syncFingerprint("a", "x")).not.toBe(syncFingerprint("b", "x")));
});
