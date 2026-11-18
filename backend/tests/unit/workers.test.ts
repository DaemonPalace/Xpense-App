import { beforeEach, describe, expect, it, vi } from "vitest";
import { ddb } from "../../src/lib/db";
import { handler as ingest } from "../../src/ingest-worker";
import { handler as forecastWorker } from "../../src/forecast-worker";

const sqs = (...bodies: object[]) => ({
  Records: bodies.map((b, i) => ({ messageId: `m${i}`, body: JSON.stringify(b), attributes: { ApproximateReceiveCount: "1" } })),
}) as any;

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
    if (name === "GetCommand") return { Item: items[cmd.input.Key.SK] } as never;
    if (name === "QueryCommand") return { Items: items[`Q:${cmd.input.ExpressionAttributeValues[":sk"]}`] ?? [] } as never;
    return {} as never;
  });
});
const updates = () => sent.filter((s) => s.name === "UpdateCommand").map((s) => ({ SK: s.input.Key.SK, values: Object.values(s.input.ExpressionAttributeValues) }));

describe("ingest-worker idempotency and guards", () => {
  const msg = { kind: "sync", userId: "u", correlationId: "c", accountId: "A", jobId: "J" };

  it("skips a job that already succeeded (SQS redelivery)", async () => {
    items["JOB#J"] = { SK: "JOB#J", status: "succeeded" };
    expect(await ingest(sqs(msg))).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.name)).toEqual(["GetCommand"]);
  });

  it("fails the job without retry when the account was removed meanwhile", async () => {
    items["JOB#J"] = { SK: "JOB#J", jobId: "J", status: "queued" };
    expect(await ingest(sqs(msg))).toEqual({ batchItemFailures: [] });
    expect(updates()).toEqual([{ SK: "JOB#J", values: expect.arrayContaining(["failed", "Account was removed"]) }]);
  });

  it("reports only the failing record of a batch", async () => {
    vi.mocked(ddb.send).mockImplementation(async (cmd: any) => {
      if (cmd.input.Key?.PK === "USER#bad") throw new Error("throttled");
      return {} as never;
    });
    const res = await ingest(sqs({ ...msg, userId: "ok" }, { ...msg, userId: "bad" }));
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
  });
});

describe("forecast-worker", () => {
  it("recomputes once per user per batch and skips deleted users", async () => {
    const res = await forecastWorker(sqs(
      { userId: "gone", changedAt: "2026-11-01T00:00:00Z" },
      { userId: "gone", changedAt: "2026-11-02T00:00:00Z" },
    ));
    expect(res).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.name)).toEqual(["GetCommand"]); // one profile read, nothing written
  });

  it("fails every message of a user whose recompute throws", async () => {
    vi.mocked(ddb.send).mockRejectedValue(new Error("down"));
    const res = await forecastWorker(sqs({ userId: "u", changedAt: "a" }, { userId: "u", changedAt: "b" }));
    expect(res!.batchItemFailures).toEqual([{ itemIdentifier: "m0" }, { itemIdentifier: "m1" }]);
  });

  it("writes aggregates and a forecast stamped with the change marker", async () => {
    items.PROFILE = { lastTxnChangeAt: "2026-11-05T00:00:00.000Z" };
    items["Q:TXN#"] = [{ date: "2026-10-03", amountMinor: 500, type: "expense", category: "food" }];
    await forecastWorker(sqs({ userId: "u", changedAt: "x" }));
    const batch = sent.find((s) => s.name === "BatchWriteCommand")!.input.RequestItems;
    expect(Object.values(batch)[0]).toEqual([{ PutRequest: { Item: expect.objectContaining({ PK: "USER#u", SK: "AGG#2026-10", expenseMinor: 500 }) } }]);
    const fc = sent.find((s) => s.name === "PutCommand" && s.input.Item.SK === "FORECAST")!.input.Item;
    expect(fc).toMatchObject({ sourceChangedAt: "2026-11-05T00:00:00.000Z", status: "insufficient_history" });
  });
});
