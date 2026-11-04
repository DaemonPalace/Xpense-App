import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/auth")>()),
  requireOrigin: () => undefined,
  requireUser: async () => ({ sub: "B" }),
}));

const { handler } = await import("../../src/api");
const { ddb } = await import("../../src/lib/db");

const calls: any[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.spyOn(ddb, "send").mockImplementation(async (cmd: any) => {
    calls.push(cmd.input);
    const name = cmd.constructor.name;
    if (name === "GetCommand") return cmd.input.Key.SK === "PROFILE" ? { Item: { PK: "USER#B", SK: "PROFILE", lastActiveAt: new Date().toISOString() } } : {};
    if (name === "TransactWriteCommand" && cmd.input.TransactItems.some((t: any) => t.Delete?.ConditionExpression)) {
      throw Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" });
    }
    return { Items: [] };
  });
});

const call = (method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}) =>
  handler({
    rawPath: path,
    headers: {},
    queryStringParameters: opts.query,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    requestContext: { http: { method } },
  } as any);

/** Every partition key the handler touched. */
function partitionKeys(): string[] {
  const keys: string[] = [];
  const visit = (input: any) => {
    if (input.Key?.PK) keys.push(input.Key.PK);
    if (input.Item?.PK && !String(input.Item.PK).startsWith("ACTIVE#")) keys.push(input.Item.PK);
    if (input.ExpressionAttributeValues?.[":pk"]) keys.push(input.ExpressionAttributeValues[":pk"]);
    for (const t of input.TransactItems ?? []) Object.values(t).forEach(visit);
  };
  calls.forEach(visit);
  return keys;
}

describe("api authorization (SC-009)", () => {
  it("returns 404 for another user's transaction and only touches USER#B", async () => {
    const res = await call("PUT", "/api/transactions/AAA", {
      query: { date: "2026-10-01" },
      body: { date: "2026-10-01", amountMinor: 100, type: "expense", category: "food", description: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(partitionKeys().every((k) => k === "USER#B")).toBe(true);
  });

  it("delete of a missing/foreign transaction is 404", async () => {
    const res = await call("DELETE", "/api/transactions/AAA", { query: { date: "2026-10-01" } });
    expect(res.statusCode).toBe(404);
    expect(partitionKeys().every((k) => k === "USER#B")).toBe(true);
  });

  it("ignores userId/sub supplied by the client", async () => {
    await call("GET", "/api/transactions", { query: { userId: "A", sub: "A" } as any });
    await call("POST", "/api/transactions", {
      body: { date: "2026-10-01", amountMinor: 100, type: "expense", category: "food", description: "x", userId: "A", sub: "A" },
    });
    const keys = partitionKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k === "USER#B")).toBe(true);
  });

  it("rejects forged pagination cursors pointing at another user", async () => {
    const cursor = Buffer.from(JSON.stringify({ PK: "USER#A", SK: "TXN#2026-10-01#X" })).toString("base64url");
    const res = await call("GET", "/api/transactions", { query: { cursor } });
    expect(res.statusCode).toBe(400);
  });
});
