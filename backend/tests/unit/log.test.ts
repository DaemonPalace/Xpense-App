import { describe, expect, it, vi } from "vitest";
import { errorFields, log, redact, withCorrelation } from "../../src/lib/log";

describe("redact (FR-030)", () => {
  it("drops secret keys at any depth, case-insensitively", () => {
    expect(redact({ user: "a", Password: "x", nested: { refreshToken: "y", ok: 1 }, list: [{ authorization: "z" }] })).toEqual({
      user: "a",
      nested: { ok: 1 },
      list: [{}],
    });
  });

  it("masks digit runs of 8+ but keeps short numbers", () => {
    expect(redact("acct 1234567890 ref 1234567")).toBe("acct ****7890 ref 1234567");
    expect(redact(42)).toBe(42);
  });
});

describe("withCorrelation", () => {
  it("keeps safe ids and replaces unsafe or missing ones", () => {
    expect(withCorrelation("abc-123_X")).toBe("abc-123_X");
    for (const bad of [undefined, null, "", "a b", "x".repeat(65), "<script>"]) expect(withCorrelation(bad)).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe("log", () => {
  it("writes one redacted JSON line, errors to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    log("info", "hi", { correlationId: "c", token: "secret" });
    log("error", "boom", errorFields(new TypeError("bad")));
    expect(JSON.parse(out.mock.calls[0][0])).toEqual({ level: "info", message: "hi", component: "unknown", correlationId: "c" });
    expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({ level: "error", errorType: "TypeError", errorMessage: "bad" });
    expect(errorFields("str")).toEqual({ errorType: "Unknown", errorMessage: "str" });
  });
});
