import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/auth")>()),
  requireOrigin: () => undefined,
  requireUser: async () => ({ sub: "U" }),
}));

const { handler } = await import("../../src/api");
const { ddb } = await import("../../src/lib/db");

let profile: Record<string, unknown>;
let items: Record<string, any[]>;
const writes: any[] = [];

beforeEach(() => {
  profile = { PK: "USER#U", SK: "PROFILE", currency: "COP", lastActiveAt: new Date().toISOString() };
  items = {};
  writes.length = 0;
  vi.spyOn(ddb, "send").mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    if (name === "GetCommand") return { Item: input.Key.SK === "PROFILE" ? profile : undefined };
    if (name === "QueryCommand") return { Items: items[input.ExpressionAttributeValues[":sk"]] ?? [] };
    if (name === "UpdateCommand") return { Attributes: { ...profile, consentVersion: input.ExpressionAttributeValues[":v"] } };
    writes.push({ name, input });
    return {};
  });
});

const call = (method: string, path: string, body?: unknown) =>
  handler({ rawPath: path, headers: {}, body: body ? JSON.stringify(body) : undefined, requestContext: { http: { method } } } as any).then((r: any) => ({
    status: r.statusCode,
    body: r.body ? JSON.parse(r.body) : undefined,
  }));

describe("consent gate (FR-1.2)", () => {
  it("blocks writes until consent, allows consenting and reads", async () => {
    expect((await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 100 })).body.error.code).toBe("consent_required");
    expect((await call("GET", "/api/summary")).status).toBe(200);
    expect((await call("POST", "/api/me/consent", { version: "2026-11" })).body.consentVersion).toBe("2026-11");
    expect(writes).toHaveLength(0);
  });
});

describe("incomes and goals", () => {
  beforeEach(() => void (profile.consentVersion = "2026-11"));

  it("creates an income under the user's partition", async () => {
    const res = await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 80_000_000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Mesada", dayOfMonth: 1 });
    expect(writes[0].input.Item.SK).toMatch(/^INCOME#/);
    expect(writes[0].input.Item.PK).toBe("USER#U");
  });

  it("rejects bad input", async () => {
    expect((await call("POST", "/api/incomes", { name: "x", kind: "lottery", amountMinor: 1 })).status).toBe(400);
    expect((await call("POST", "/api/goals", { name: "Viaje", targetMinor: 1, monthly: false })).status).toBe(400);
    expect((await call("POST", "/api/goals", { name: "Meta", targetMinor: -5, monthly: true })).status).toBe(400);
  });

  it("PUT on a missing goal is 404", async () => {
    expect((await call("PUT", "/api/goals/NOPE", { name: "Meta", targetMinor: 5, monthly: true })).status).toBe(404);
  });
});

describe("GET /api/summary", () => {
  it("combines incomes, goals and this month's transactions", async () => {
    profile.consentVersion = "2026-11";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    items["INCOME#"] = [{ amountMinor: 100_000_000 }];
    items["GOAL#"] = [{ targetMinor: 20_000_000, monthly: true }];
    items[`TXN#${today.slice(0, 7)}-`] = [{ date: today, amountMinor: 1_500_000, type: "expense" }];
    const { status, body } = await call("GET", "/api/summary");
    expect(status).toBe(200);
    expect(body).toMatchObject({ consented: true, onboarded: true, currency: "COP", allowedMinor: 80_000_000, spentTodayMinor: 1_500_000, today });
  });
});
