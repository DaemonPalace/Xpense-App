import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { client, consentedUser, dlq, newUser, pushes, queues, settle, skipToLatest, uploads } from "./harness";
import { firstSyncStart, generate } from "../../src/lib/simulator";
import { parseImport } from "../../src/lib/csv";
import { localToday } from "../../src/lib/summary";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const today = localToday();

/** Follows the API's pagination cursor to the end. */
async function allTransactions(call: ReturnType<typeof client>, query = "") {
  const items: any[] = [];
  let cursor: string | null = null;
  do {
    const res = await call("GET", `/api/transactions?${query}${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.status).toBe(200);
    items.push(...res.body.items);
    cursor = res.body.cursor;
  } while (cursor);
  return items;
}

beforeAll(skipToLatest);

describe("edge of the API", () => {
  it("rejects requests without the CloudFront origin secret or a bearer token", async () => {
    const { handler } = await import("../../src/api");
    const base = { rawPath: "/api/me", requestContext: { http: { method: "GET" } } };
    expect((await handler({ ...base, headers: { authorization: "Bearer x" } } as any)).statusCode).toBe(403);
    expect((await handler({ ...base, headers: { "x-origin-secret": process.env.ORIGIN_SECRET } } as any)).statusCode).toBe(401);
  });

  it("echoes a valid correlation id", async () => {
    const { handler } = await import("../../src/api");
    const res = await handler({
      rawPath: "/api/me",
      headers: { authorization: "Bearer " + newUser(), "x-origin-secret": process.env.ORIGIN_SECRET, "x-correlation-id": "abc-123" },
      requestContext: { http: { method: "GET" } },
    } as any);
    expect(res.headers!["x-correlation-id"]).toBe("abc-123");
  });
});

describe("onboarding and safe-to-spend", () => {
  it("creates the profile, gates writes on consent, then budgets from incomes and goals", async () => {
    const call = client(newUser());
    const me = await call("GET", "/api/me");
    expect(me).toMatchObject({ status: 200, body: { currency: "COP", hasTransactions: false } });

    expect((await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 100_000_000 })).body.error.code).toBe("consent_required");
    expect((await call("POST", "/api/me/consent", { version: "2026-11" })).status).toBe(200);

    expect((await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 100_000_000 })).status).toBe(201);
    const goal = await call("POST", "/api/goals", { name: "Ahorro", targetMinor: 20_000_000, monthly: true });
    expect(goal.status).toBe(201);
    expect((await call("PUT", `/api/goals/${goal.body.id}`, { name: "Ahorro", targetMinor: 30_000_000, monthly: true })).status).toBe(200);
    expect((await call("GET", "/api/goals")).body).toHaveLength(1);

    const summary = (await call("GET", "/api/summary")).body;
    expect(summary).toMatchObject({ consented: true, onboarded: true, inflowsMinor: 100_000_000, allowedMinor: 70_000_000, spentMinor: 0 });

    expect((await call("DELETE", `/api/goals/${goal.body.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/goals/${goal.body.id}`)).status).toBe(404);
  });

  it("locks the currency once the user has transactions", async () => {
    const { call } = await consentedUser();
    expect((await call("PATCH", "/api/me", { currency: "USD", displayName: " Ana " })).body).toMatchObject({ currency: "USD", displayName: "Ana" });
    await call("POST", "/api/transactions", { date: today, amountMinor: 100, type: "expense", category: "food", description: "Tinto" });
    expect((await call("PATCH", "/api/me", { currency: "COP" })).body.error.code).toBe("currency_locked");
  });
});

describe("manual transactions → stream → forecast worker", () => {
  it("CRUD updates aggregates and the insights stop 'processing' once the pipeline settles", async () => {
    const { call } = await consentedUser();
    const lunch = (await call("POST", "/api/transactions", { date: today, amountMinor: 1_200_000, type: "expense", category: "food", description: "Almuerzo" })).body;
    await call("POST", "/api/transactions", { date: today, amountMinor: 300_000, type: "expense", category: "snacks", description: "Empanada" });

    expect((await call("GET", "/api/insights")).body.processing).toBe(true);
    await settle();
    let insights = (await call("GET", "/api/insights")).body;
    expect(insights.processing).toBe(false);
    expect(insights.months.at(-1)).toMatchObject({ month: today.slice(0, 7), expenseMinor: 1_500_000 });

    // Moving a transaction to another category rewrites the aggregate.
    const moved = await call("PUT", `/api/transactions/${lunch.txnId}?date=${today}`, { ...lunch, category: "outings" });
    expect(moved.status).toBe(200);
    await settle();
    insights = (await call("GET", "/api/insights")).body;
    expect(insights.months.at(-1).totals).toEqual({
      outings: { count: 1, expenseMinor: 1_200_000, savingsMinor: 0 },
      snacks: { count: 1, expenseMinor: 300_000, savingsMinor: 0 },
    });

    expect((await call("DELETE", `/api/transactions/${lunch.txnId}?date=${today}`)).status).toBe(204);
    await settle();
    expect((await call("GET", "/api/insights")).body.months.at(-1).expenseMinor).toBe(300_000);
    expect(await allTransactions(call)).toHaveLength(1);
  });

  it("filters transactions by category and type", async () => {
    const { call } = await consentedUser();
    await call("POST", "/api/transactions", { date: today, amountMinor: 100, type: "expense", category: "food", description: "a" });
    await call("POST", "/api/transactions", { date: today, amountMinor: 200, type: "expense", category: "transport", description: "b" });
    await call("POST", "/api/transactions", { date: today, amountMinor: 300, type: "savings", category: "savings", description: "c" });
    expect((await allTransactions(call, "category=food")).map((t) => t.description)).toEqual(["a"]);
    expect((await allTransactions(call, "type=savings")).map((t) => t.description)).toEqual(["c"]);
  });

  it("fires a budget alert once and pushes it to the registered device", async () => {
    const { call } = await consentedUser();
    const token = `ExponentPushToken[${newUser()}]`;
    await call("POST", "/api/devices", { token, platform: "android" });
    await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 10_000_000 });
    await call("POST", "/api/transactions", { date: today, amountMinor: 9_000_000, type: "expense", category: "shopping", description: "Audífonos" });
    await settle();
    const mine = () => pushes.filter((p) => p.to === token).map((p) => p.title);
    expect(mine()).toContain("Pasaste tu límite de hoy");
    const count = mine().length;

    await call("POST", "/api/transactions", { date: today, amountMinor: 1, type: "expense", category: "snacks", description: "Chicle" });
    await settle();
    expect(mine().filter((t) => t === "Pasaste tu límite de hoy")).toHaveLength(1); // same period: not re-sent
    expect(mine().length).toBeGreaterThanOrEqual(count);
  });
});

describe("test bank sync (simulated account)", () => {
  it("imports 6 months, forecasts, and re-sync adds no duplicates", async () => {
    const { call } = await consentedUser();
    const created = await call("POST", "/api/accounts", { name: "Banco de prueba", type: "checking", source: "simulated" });
    expect(created.status).toBe(202);
    const { account, job } = created.body;
    expect(account.status).toBe("syncing");

    await settle();
    const utcToday = new Date().toISOString().slice(0, 10);
    const expected = generate(account.accountId, "checking", firstSyncStart(utcToday), utcToday).length;
    const done = (await call("GET", `/api/jobs/${job.jobId}`)).body;
    expect(done).toMatchObject({ status: "succeeded", imported: expected, skipped: 0 });
    expect((await call("GET", "/api/accounts")).body[0]).toMatchObject({ status: "synced", failureReason: null });
    expect(await allTransactions(call)).toHaveLength(expected);

    const insights = (await call("GET", "/api/insights")).body;
    expect(insights.forecast.status).toBe("ok");
    expect(insights.forecast.historyMonths).toBeGreaterThanOrEqual(2);
    expect(insights.processing).toBe(false);

    const resync = await call("POST", `/api/accounts/${account.accountId}/sync`);
    expect(resync.status).toBe(202);
    expect((await call("POST", `/api/accounts/${account.accountId}/sync`)).body.error.code).toBe("already_syncing");
    await settle();
    expect((await call("GET", `/api/jobs/${resync.body.jobId}`)).body.imported).toBe(0);
    expect(await allTransactions(call)).toHaveLength(expected);
  });

  it("deleting the account with its data removes its transactions but keeps manual ones", async () => {
    const { call } = await consentedUser();
    const { account } = (await call("POST", "/api/accounts", { name: "Banco", type: "savings", source: "simulated" })).body;
    await call("POST", "/api/transactions", { date: today, amountMinor: 500, type: "expense", category: "food", description: "Manual" });
    await settle();
    expect((await call("DELETE", `/api/accounts/${account.accountId}?deleteTransactions=true`)).status).toBe(204);
    await settle();
    expect((await allTransactions(call)).map((t) => t.description)).toEqual(["Manual"]);
    expect((await call("GET", "/api/accounts")).body).toEqual([]);
  });
});

describe("CSV import", () => {
  it("imports the sample file, reports rejections, and a re-import skips everything", async () => {
    const { sub, call } = await consentedUser();
    const { account } = (await call("POST", "/api/accounts", { name: "Tarjeta", type: "credit_card", source: "csv" })).body;
    const csv = fixture("sample.csv");
    const parsed = parseImport(csv);

    const importOnce = async () => {
      const { job, upload } = (await call("POST", "/api/imports", { accountId: account.accountId })).body;
      expect(upload.fields.key).toBe(`uploads/${sub}/${job.jobId}.csv`);
      uploads.set(upload.fields.key, csv);
      expect((await call("POST", `/api/imports/${job.jobId}/start`)).status).toBe(202);
      expect((await call("POST", `/api/imports/${job.jobId}/start`)).body.error.code).toBe("already_started");
      await settle();
      return (await call("GET", `/api/jobs/${job.jobId}`)).body;
    };

    const first = await importOnce();
    expect(first).toMatchObject({ status: "succeeded", imported: parsed.rows.length, skipped: 0, rejected: parsed.rejections.length });
    expect(first.rejected).toBeGreaterThan(0);
    const second = await importOnce();
    expect(second).toMatchObject({ imported: 0, skipped: parsed.rows.length });
    expect(await allTransactions(call)).toHaveLength(parsed.rows.length);
  });

  it("a missing upload fails the job with a user-facing reason, without retries", async () => {
    const { call } = await consentedUser();
    const { account } = (await call("POST", "/api/accounts", { name: "Tarjeta", type: "credit_card", source: "csv" })).body;
    const { job } = (await call("POST", "/api/imports", { accountId: account.accountId })).body;
    await call("POST", `/api/imports/${job.jobId}/start`);
    await settle();
    expect((await call("GET", `/api/jobs/${job.jobId}`)).body).toMatchObject({ status: "failed", failureReason: "Uploaded file not found — upload it again" });
    expect((await call("GET", "/api/accounts")).body[0].status).toBe("failed");
  });

  it("a poison file is retried 3 times, lands in the DLQ and fails the job (US4)", async () => {
    process.env.ALLOW_POISON = "true";
    try {
      const { call } = await consentedUser();
      const { account } = (await call("POST", "/api/accounts", { name: "Tarjeta", type: "credit_card", source: "csv" })).body;
      const { job, upload } = (await call("POST", "/api/imports", { accountId: account.accountId })).body;
      uploads.set(upload.fields.key, fixture("poison.csv"));
      await call("POST", `/api/imports/${job.jobId}/start`);
      const before = dlq.ingest.length;
      await settle();
      expect(dlq.ingest.slice(before).map((b) => JSON.parse(b).jobId)).toEqual([job.jobId]);
      expect((await call("GET", `/api/jobs/${job.jobId}`)).body).toMatchObject({ status: "failed", failureReason: "Processing failed after several attempts. Please retry." });
    } finally {
      delete process.env.ALLOW_POISON;
    }
  });
});

describe("vault (caja fuerte)", () => {
  it("keeps the balance and its savings transactions in step", async () => {
    const { call } = await consentedUser();
    expect((await call("POST", "/api/vault/deposit", { amountMinor: 5_000_000 })).body.balanceMinor).toBe(5_000_000);
    expect((await call("POST", "/api/vault/withdraw", { amountMinor: 2_000_000 })).body.balanceMinor).toBe(3_000_000);
    expect((await call("POST", "/api/vault/withdraw", { amountMinor: 3_000_001 })).body.error.code).toBe("insufficient_vault");
    expect((await call("GET", "/api/vault")).body.balanceMinor).toBe(3_000_000);

    const txns = await allTransactions(call);
    expect(txns.map((t) => t.amountMinor).sort()).toEqual([-2_000_000, 5_000_000].sort());
    // Vault movements can't be edited or deleted as plain transactions.
    expect((await call("DELETE", `/api/transactions/${txns[0].txnId}?date=${txns[0].date}`)).status).toBe(404);
    expect((await call("PUT", `/api/transactions/${txns[0].txnId}?date=${txns[0].date}`, { ...txns[0], amountMinor: 1 })).body.error.code).toBe("vault_transaction");
  });
});

describe("isolation between users (SC-009)", () => {
  it("user B can neither read nor change user A's data", async () => {
    const a = await consentedUser();
    const b = await consentedUser();
    const txn = (await a.call("POST", "/api/transactions", { date: today, amountMinor: 700, type: "expense", category: "food", description: "De A" })).body;
    const { account } = (await a.call("POST", "/api/accounts", { name: "Cuenta A", type: "checking", source: "csv" })).body;

    expect(await allTransactions(b.call)).toEqual([]);
    expect((await b.call("PUT", `/api/transactions/${txn.txnId}?date=${today}`, { ...txn, amountMinor: 1 })).status).toBe(404);
    expect((await b.call("DELETE", `/api/transactions/${txn.txnId}?date=${today}`)).status).toBe(404);
    expect((await b.call("DELETE", `/api/accounts/${account.accountId}?deleteTransactions=true`)).status).toBe(404);
    expect((await b.call("POST", "/api/imports", { accountId: account.accountId })).status).toBe(404);

    expect(await allTransactions(a.call)).toMatchObject([{ txnId: txn.txnId, amountMinor: 700 }]);
  });
});

describe("account deletion (Habeas Data)", () => {
  it("DELETE /api/me erases every item of the user and nothing of anyone else", async () => {
    const other = await consentedUser();
    await other.call("POST", "/api/transactions", { date: today, amountMinor: 100, type: "expense", category: "food", description: "Otro" });
    const { call } = await consentedUser();
    await call("POST", "/api/accounts", { name: "Banco", type: "checking", source: "simulated" });
    await call("POST", "/api/incomes", { name: "Mesada", kind: "allowance", amountMinor: 100 });
    await settle();

    expect((await call("DELETE", "/api/me")).status).toBe(202);
    expect(queues.ingest.at(-1)!.body).toContain('"kind":"deleteUser"');
    await settle();

    // A fresh GET recreates an empty profile; nothing old survives.
    expect(await allTransactions(call)).toEqual([]);
    expect((await call("GET", "/api/accounts")).body).toEqual([]);
    expect((await call("GET", "/api/incomes")).body).toEqual([]);
    expect((await call("GET", "/api/me")).body.consentVersion).toBeUndefined();
    expect(await allTransactions(other.call)).toHaveLength(1);
  });
});
