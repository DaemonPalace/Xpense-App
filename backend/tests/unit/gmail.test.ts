import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TOKEN_KEY = randomBytes(32).toString("base64");
Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "https://x.test/api/gmail/callback" });

vi.mock("../../src/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/auth")>()),
  requireOrigin: () => undefined,
  requireUser: async () => ({ sub: "U" }),
}));

const { decrypt, encrypt, searchQuery, toMail } = await import("../../src/lib/gmail");
const { handler: api } = await import("../../src/api");
const { handler: ingest } = await import("../../src/ingest-worker");
const { ddb } = await import("../../src/lib/db");

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const ALERT = { id: "g1", payload: { headers: [{ name: "Subject", value: "Alertas" }, { name: "Date", value: "Sat, 15 Nov 2026 22:30:00 -0500" }], parts: [
  { mimeType: "text/plain", body: { data: b64("Bancolombia le informa Compra por $25.000,00 en RAPPI COLOMBIA 12:30.") } },
  { mimeType: "application/pdf", filename: "x.pdf", body: { attachmentId: "a" } },
] } };
const CREDIT = { id: "g2", payload: { headers: [{ name: "Subject", value: "Recibiste" }], mimeType: "text/html", body: { data: b64("<p>¡Hola, SANTIAGO!</p><p>Recibiste 50.000 de JUAN PEREZ el 14 de noviembre de 2026</p>") } } };

/** Fake Google: token endpoint, profile, search and message fetch. */
function fakeGoogle(opts: { invalidGrant?: boolean; flaky?: boolean } = {}) {
  let failed = false;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = String(input);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (opts.flaky && !failed) return (failed = true), json({ error: { code: 503 } }, 503);
    if (url.includes("oauth2.googleapis.com/token"))
      return opts.invalidGrant ? json({ error: "invalid_grant" }, 400) : json({ access_token: "at", refresh_token: "rt", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    if (url.endsWith("/profile")) return json({ emailAddress: "me@gmail.com" });
    if (url.includes("/messages?")) return json({ messages: [{ id: "g1" }, { id: "g2" }] });
    if (url.includes("/messages/g1")) return json(ALERT);
    if (url.includes("/messages/g2")) return json(CREDIT);
    return json({}, 404);
  });
}

let items: Record<string, any>;
let sent: { name: string; input: any }[];
beforeEach(() => {
  items = {};
  sent = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ddb, "send").mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name;
    sent.push({ name, input: cmd.input });
    const k = cmd.input.Key ? `${cmd.input.Key.PK}|${cmd.input.Key.SK}` : "";
    if (name === "GetCommand") return { Item: items[k] } as never;
    if (name === "DeleteCommand") return { Attributes: items[k] } as never;
    if (name === "QueryCommand") return { Items: [] } as never;
    return {} as never;
  });
});
afterEach(() => vi.restoreAllMocks());

const written = () => sent.flatMap((s) => [s.input.Item, ...(s.input.TransactItems ?? []).map((t: any) => t.Put?.Item), ...(s.input.RequestItems ? Object.values(s.input.RequestItems).flat().map((r: any) => r.PutRequest?.Item) : [])]).filter(Boolean);

describe("gmail helpers", () => {
  it("round-trips the encrypted refresh token", () => {
    const sealed = encrypt("1//refresh");
    expect(sealed).not.toContain("refresh");
    expect(decrypt(sealed)).toBe("1//refresh");
  });
  it("extracts text from multipart and html-only messages", () => {
    expect(toMail(ALERT).body).toContain("Compra por $25.000,00");
    expect(toMail(CREDIT).body).toContain("Recibiste 50.000");
  });
  it("searches bank senders after a unix time", () => {
    expect(searchQuery(new Date(1_700_000_000_000))).toMatch(/^from:\(bancolombia OR .*\) after:1700000000$/);
  });
});

describe("gmail connect + callback", () => {
  const req = (method: string, path: string, extra: any = {}) => api({ rawPath: path, headers: {}, requestContext: { http: { method } }, ...extra } as any);

  it("only returns to app links", async () => {
    items["USER#U|PROFILE"] = { consentVersion: "v1", lastActiveAt: new Date().toISOString() };
    expect((await req("POST", "/api/gmail/connect", { body: JSON.stringify({ returnTo: "https://evil.test" }) })).statusCode).toBe(400);
    const ok = await req("POST", "/api/gmail/connect", { body: JSON.stringify({ returnTo: "exp://10.0.0.2:8081/--/cuentas" }) });
    expect(JSON.parse(ok.body!).url).toMatch(/^https:\/\/accounts\.google\.com\/.*access_type=offline/);
  });

  it("editing own banks re-imports the Gmail account with the new rules", async () => {
    items["USER#U|PROFILE"] = { consentVersion: "v1", lastActiveAt: new Date().toISOString() };
    items["USER#U|ACCT#A"] = { PK: "USER#U", SK: "ACCT#A", accountId: "A", source: "gmail", ownBanks: ["NEQUI"], ownAccounts: ["NEQUI:6342", "DAVIPLATA:1"] };
    expect((await req("PATCH", "/api/accounts/A", { body: JSON.stringify({ ownBanks: ["nequi"] }) })).statusCode).toBe(400);
    const res = await req("PATCH", "/api/accounts/A", { body: JSON.stringify({ ownBanks: ["RAPPIPAY", "NEQUI"] }) });
    expect(res.statusCode).toBe(202);
    const tx = sent.find((x) => x.name === "TransactWriteCommand")!.input.TransactItems;
    expect(tx[0].Update.ExpressionAttributeValues).toMatchObject({ ":b": ["NEQUI", "RAPPIPAY"], ":a": ["NEQUI:6342"], ":null": null });
    expect(tx[1].Put.Item).toMatchObject({ kind: "sync", status: "queued", rebuild: true });
  });

  it("rejects an unknown state", async () => {
    expect((await req("GET", "/api/gmail/callback", { queryStringParameters: { state: "nope", code: "c" } })).statusCode).toBe(400);
  });

  it("stores an encrypted token, creates the account and queues the backfill", async () => {
    fakeGoogle();
    items["OAUTH#s1|OAUTH"] = { userId: "U", returnTo: "xpense://cuentas", expiresAt: Date.now() / 1000 + 60 };
    const res = await req("GET", "/api/gmail/callback", { queryStringParameters: { state: "s1", code: "c" } });
    expect(res.statusCode).toBe(302);
    expect((res as any).headers.location).toMatch(/^xpense:\/\/cuentas\?gmail=ok&jobId=/);
    const w = written();
    expect(w.find((i) => i.SK === "GMAIL")).toMatchObject({ accountId: expect.any(String), email: "me@gmail.com" });
    expect(decrypt(w.find((i) => i.SK === "GMAIL").token)).toBe("rt");
    expect(w.find((i) => String(i.SK).startsWith("ACCT#"))).toMatchObject({ source: "gmail", name: "me@gmail.com", status: "syncing" });
    expect(w.find((i) => String(i.SK).startsWith("JOB#"))).toMatchObject({ kind: "sync", status: "queued" });
    expect(w.find((i) => i.PK === "GMAIL")).toMatchObject({ SK: "USER#U" });
  });
});

describe("gmail sync in ingest-worker", () => {
  const msg = { kind: "sync", userId: "U", correlationId: "c", accountId: "A", jobId: "J" };
  const sqs = { Records: [{ messageId: "m0", body: JSON.stringify(msg), attributes: { ApproximateReceiveCount: "1" } }] } as any;
  beforeEach(() => {
    items["USER#U|JOB#J"] = { SK: "JOB#J", jobId: "J", status: "queued" };
    items["USER#U|ACCT#A"] = { SK: "ACCT#A", accountId: "A", source: "gmail", lastSyncedAt: null };
    items["USER#U|GMAIL"] = { token: encrypt("rt"), accountId: "A" };
  });

  it("imports money out as expenses and money in as one-off incomes", async () => {
    fakeGoogle();
    expect(await ingest(sqs)).toEqual({ batchItemFailures: [] });
    const txns = written().filter((i) => String(i.SK).startsWith("TXN#"));
    expect(txns).toEqual([expect.objectContaining({ amountMinor: 2_500_000, category: "food", origin: "email", accountId: "A", date: "2026-11-15" })]);
    const incomes = written().filter((i) => String(i.SK).startsWith("INCOME#"));
    expect(incomes).toEqual([expect.objectContaining({ name: "Recibiste de Juan Perez", amountMinor: 5_000_000, kind: "other", month: expect.stringMatching(/^\d{4}-\d{2}$/), accountId: "A" })]);
  });

  it("retries a transient Google 503", async () => {
    fakeGoogle({ flaky: true });
    expect(await ingest(sqs)).toEqual({ batchItemFailures: [] });
    expect(written().some((i) => String(i.SK).startsWith("TXN#"))).toBe(true);
  });

  it("fails the job with a reconnect message when Google access expired", async () => {
    fakeGoogle({ invalidGrant: true });
    expect(await ingest(sqs)).toEqual({ batchItemFailures: [] });
    const reasons = sent.filter((s) => s.name === "UpdateCommand").flatMap((s) => Object.values(s.input.ExpressionAttributeValues));
    expect(reasons).toContain("Gmail access expired or was revoked — reconnect Gmail");
  });
});
