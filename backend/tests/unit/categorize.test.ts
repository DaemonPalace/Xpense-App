import { describe, expect, it } from "vitest";
import { categorize } from "../../src/lib/categorize";

describe("categorize", () => {
  it.each([
    ["Rent payment", "housing"],
    ["GROCERY MARKET #12", "food"],
    ["Uber trip", "transport"],
    ["Electric utility bill", "utilities"],
    ["Netflix subscription", "entertainment"],
    ["City Pharmacy", "health"],
    ["Amazon order", "shopping"],
    ["Transfer to savings", "savings"],
    ["Mystery charge", "other"],
  ])("%s → %s", (d, c) => expect(categorize(d)).toBe(c));
});
