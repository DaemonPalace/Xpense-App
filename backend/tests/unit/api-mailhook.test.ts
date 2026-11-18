import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/auth")>()),
  requireOrigin: () => undefined,
  requireUser: async () => { throw new Error("webhook must not need a Cognito token"); },
}));

const { handler } = await import("../../src/api");
const { ddb } = await import("../../src/lib/db");

const TOKEN = "a".repeat(43);
const UNKNOWN = "b".repeat(43);
let writes: any[] = [];
let duplicate = false;
beforeEach(() => {
  writes = [];
  duplicate = false;
  vi.spyOn(ddb, "send").mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name;
    if (name === "GetCommand") {
      const { PK, SK } = cmd.input.Key;
      if (SK === "MAILHOOK") return PK === `MAILHOOK#${createHash("sha256").update(UNKNOWN).digest("hex")}` ? {} : { Item: { userId: "U", accountId: "ACC" } };
      if (SK === "PROFILE") return { Item: { consentVersion: "v1" } };
    }
    if (name === "TransactWriteCommand") {
      if (duplicate) throw Object.assign(new Error("x"), { name: "TransactionCanceledException" });
      writes.push(cmd.input);
    }
    return {};
  });
});

const post = (body: unknown, token = TOKEN, form = false) =>
  handler({
    rawPath: `/api/hooks/mail/${token}`,
    headers: form ? { "content-type": "application/x-www-form-urlencoded" } : { "content-type": "application/json" },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    requestContext: { http: { method: "POST" } },
  } as any);

const alert = { subject: "Alertas", body_plain: "Bancolombia le informa Compra por $25.000,00 en RAPPI COLOMBIA 12:30.", date: "Sat, 15 Nov 2026 22:30:00 -0500", message_id: "m1" };

describe("mail webhook", () => {
  it("creates an expense on the hook's account without a Cognito token", async () => {
    const res = await post(alert);
    expect(res.statusCode).toBe(201);
    const item = writes[0].TransactItems[0].Put.Item;
    expect(item).toMatchObject({ PK: "USER#U", accountId: "ACC", amountMinor: 2_500_000, category: "food", origin: "email", date: "2026-11-15" });
  });
  it("accepts form-encoded bodies (Zapier default)", async () => {
    expect((await post(alert, TOKEN, true)).statusCode).toBe(201);
  });
  it("is idempotent and ignores non-debit mails with 200", async () => {
    duplicate = true;
    expect(JSON.parse((await post(alert)).body!).reason).toBe("duplicate");
    expect(JSON.parse((await post({ subject: "Recibiste", body: "Recibiste $50.000 de JUAN" })).body!).imported).toBe(false);
  });
  it("rejects unknown tokens", async () => {
    expect((await post(alert, UNKNOWN)).statusCode).toBe(401);
  });
});
