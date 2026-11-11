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

const call = (method: string, url: string, body?: unknown) => {
  const [path, qs] = url.split("?");
  return handler({
    rawPath: path,
    headers: {},
    queryStringParameters: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: { http: { method } },
  } as any).then((r: any) => ({
    status: r.statusCode,
    body: r.body ? JSON.parse(r.body) : undefined,
  }));
};

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

describe("vault and devices", () => {
  beforeEach(() => void (profile.consentVersion = "2026-11"));

  it("deposit writes balance + savings transaction atomically", async () => {
    const res = await call("POST", "/api/vault/deposit", { amountMinor: 5_000_000 });
    expect(res.status).toBe(201);
    const tw = writes.find((w) => w.name === "TransactWriteCommand").input.TransactItems;
    expect(tw[0].Update.Key.SK).toBe("VAULT");
    expect(tw[1].Put.Item).toMatchObject({ type: "savings", category: "savings", origin: "vault", amountMinor: 5_000_000 });
  });

  it("withdraw more than the balance is 409", async () => {
    vi.mocked(ddb.send).mockImplementation(async (cmd: any) => {
      if (cmd.constructor.name === "GetCommand") return { Item: cmd.input.Key.SK === "PROFILE" ? profile : undefined };
      if (cmd.constructor.name === "TransactWriteCommand") throw Object.assign(new Error("x"), { name: "TransactionCanceledException" });
      return {};
    });
    expect((await call("POST", "/api/vault/withdraw", { amountMinor: 1 })).body.error.code).toBe("insufficient_vault");
  });

  it("vault movements can't be deleted through the transactions API", async () => {
    expect((await call("DELETE", "/api/transactions/X?date=2026-11-01")).status).toBe(204);
    const del = writes.find((w) => w.name === "TransactWriteCommand").input.TransactItems[0].Delete;
    expect(del.ConditionExpression).toContain("origin <> :vault");
    expect(del.ExpressionAttributeValues[":vault"]).toBe("vault");
  });

  it("stores a bug report (F16)", async () => {
    expect((await call("POST", "/api/feedback", { message: "  " })).status).toBe(400);
    expect((await call("POST", "/api/feedback", { message: " No carga el resumen ", appVersion: "1.0.0" })).status).toBe(201);
    const item = writes.at(-1).input.Item;
    expect(item).toMatchObject({ PK: "USER#U", message: "No carga el resumen", appVersion: "1.0.0" });
    expect(item.SK).toMatch(/^FEEDBACK#\d{4}-/);
  });

  it("one-off incomes count only in their month", async () => {
    expect((await call("POST", "/api/incomes", { name: "Regalo", kind: "other", amountMinor: 100, month: "2026-13" })).status).toBe(400);
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date()).slice(0, 7);
    items["INCOME#"] = [{ amountMinor: 1000 }, { amountMinor: 200, month }, { amountMinor: 50, month: "2020-01" }];
    expect((await call("GET", "/api/summary")).body).toMatchObject({ inflowsMinor: 1200, recurringInflowsMinor: 1000 });
  });

  it("devices accept only Expo push tokens", async () => {
    expect((await call("POST", "/api/devices", { token: "abc", platform: "ios" })).status).toBe(400);
    expect((await call("POST", "/api/devices", { token: "ExponentPushToken[xYz-123]", platform: "android" })).status).toBe(201);
  });

  it("summary flags ant expenses and reports the vault", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    items["INCOME#"] = [{ amountMinor: 100_000_000 }];
    items[`TXN#${today.slice(0, 7)}-`] = [1, 2, 3].map((i) => ({ txnId: `t${i}`, date: today, amountMinor: 500_000, type: "expense", category: "snacks" }));
    const { body } = await call("GET", "/api/summary");
    expect(body.ant).toMatchObject({ count: 3, totalMinor: 1_500_000, txnIds: ["t1", "t2", "t3"] });
    expect(body.vaultBalanceMinor).toBe(0);
    expect(body.byCategoryMinor).toEqual({ snacks: 1_500_000 });
  });
});
