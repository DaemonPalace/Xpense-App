import { describe, expect, it } from "vitest";
import { parseCsv, parseImport } from "../../src/lib/csv";

const now = new Date("2026-10-24T00:00:00Z");

describe("parseCsv", () => {
  it("handles quotes, embedded commas, quotes and newlines, CRLF", () => {
    expect(parseCsv('a,"b,c","d ""q""","e\nf"\r\n1,2,3,4\r\n')).toEqual([
      ["a", "b,c", 'd "q"', "e\nf"],
      ["1", "2", "3", "4"],
    ]);
  });
});

describe("parseImport", () => {
  it("parses valid rows with optional category", () => {
    const { rows, rejections } = parseImport("date,description,amount,category\n2026-10-01,Rent,1400.00,housing\n2026-10-02,Coffee,3.5,\n", now);
    expect(rejections).toEqual([]);
    expect(rows.map((r) => [r.amountMinor, r.category])).toEqual([[140000, "housing"], [350, undefined]]);
  });
  it("rejects bad rows with line numbers", () => {
    const { rows, rejections } = parseImport("date,description,amount\n2026-13-01,A,1\n2027-01-01,B,1\n2026-10-01,C,0\n2026-10-01,D,abc\n2026-10-01,E,2\n", now);
    expect(rows).toHaveLength(1);
    expect(rejections.map((r) => r.row)).toEqual([2, 3, 4, 5]);
  });
  it("errors on empty file and bad header", () => {
    expect(() => parseImport("", now)).toThrow(/empty/);
    expect(() => parseImport("when,what,how much\n", now)).toThrow(/Header/);
  });
});

describe("sample.csv fixture", () => {
  it("has 20 valid rows and 1 rejected (bad date)", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../fixtures/sample.csv", import.meta.url), "utf8");
    const { rows, rejections } = parseImport(text, now);
    expect(rows).toHaveLength(20);
    expect(rejections).toEqual([{ row: 18, reason: "date is not a valid calendar date" }]);
    expect(rows.find((r) => r.description.includes("Luigi"))?.description).toBe('Restaurant "Luigi\'s", dinner');
  });
});
