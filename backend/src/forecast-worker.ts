import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { activePk, aggSk, batchWriteAll, ddb, delReq, forecastSk, profileSk, putReq, queryAll, TABLE, userPk } from "./lib/db";
import { aggregate } from "./lib/aggregate";
import { dueAlerts } from "./lib/alerts";
import { forecast } from "./lib/forecast";
import { sendPush } from "./lib/push";
import { localToday, summarize } from "./lib/summary";
import { errorFields, log } from "./lib/log";

const sqs = new SQSClient({});

interface RecomputeUser {
  userId: string;
  correlationId?: string;
  changedAt: string;
}

export async function recompute(userId: string, correlationId?: string) {
  const PK = userPk(userId);
  const profile = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: profileSk() } }))).Item;
  if (!profile) return log("info", "skip recompute: user deleted", { correlationId, userId });
  // Read the change marker before the transactions, so everything up to it is included.
  const sourceChangedAt = profile.lastTxnChangeAt ?? new Date(0).toISOString();
  const [txns, oldAggs] = await Promise.all([
    queryAll(PK, "TXN#", { ProjectionExpression: "#d, amountMinor, #t, category", ExpressionAttributeNames: { "#d": "date", "#t": "type" } }),
    queryAll(PK, "AGG#", { ProjectionExpression: "PK, SK" }),
  ]);
  const months = aggregate(txns as any);
  const computedAt = new Date().toISOString();
  const writes = [...months.values()].map((m) => putReq({ PK, SK: aggSk(m.month), ...m, computedAt }));
  const stale = oldAggs.filter((a) => !months.has(a.SK.slice(4))).map((a) => delReq(a.PK, a.SK));
  await batchWriteAll([...writes, ...stale]);
  const result = forecast(months.values());
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { PK, SK: forecastSk(), ...result, computedAt, sourceChangedAt } }));
  log("info", "forecast recomputed", { correlationId, userId, transactions: txns.length, months: months.size, status: result.status });
  await fireAlerts(userId, txns, correlationId);
}

/** Records each due alert once (conditional put) and pushes it to the user's devices. */
async function fireAlerts(userId: string, txns: Record<string, any>[], correlationId?: string) {
  const PK = userPk(userId);
  const today = localToday();
  const [incomes, goals] = await Promise.all([queryAll(PK, "INCOME#"), queryAll(PK, "GOAL#")]);
  const alerts = dueAlerts(summarize(today, incomes as any[], goals as any[], txns as any[]), today);
  if (!alerts.length) return;
  const expiresAt = Math.floor(Date.now() / 1000) + 100 * 86400;
  let devices: string[] | undefined;
  for (const a of alerts) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: { PK, SK: a.sk, kind: a.kind, title: a.title, body: a.body, firedAt: new Date().toISOString(), expiresAt },
          ConditionExpression: "attribute_not_exists(SK)",
        }),
      );
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") continue; // already fired this period
      throw e;
    }
    devices ??= (await queryAll(PK, "DEVICE#", { ProjectionExpression: "#t", ExpressionAttributeNames: { "#t": "token" } })).map((d) => d.token);
    const gone = await sendPush(devices, a.title, a.body, correlationId).catch((err) => (log("warn", "push failed", { correlationId, ...errorFields(err) }), []));
    for (const token of gone) await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK: `DEVICE#${token}` } }));
    log("info", "alert fired", { correlationId, userId, kind: a.kind, devices: devices.length });
  }
}

/** Scheduler mode: enqueue every user active in the last ~3 months (data-model "Activity marker"). */
async function fanOut() {
  const d = new Date();
  const months = [0, 1, 2].map((n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 7));
  const users = new Set((await Promise.all(months.map((m) => queryAll(activePk(m), "USER#")))).flat().map((i) => i.SK.slice(5)));
  const changedAt = new Date().toISOString();
  const messages = [...users].map((userId) => ({ userId, changedAt, correlationId: `daily-${changedAt.slice(0, 10)}` }));
  for (let i = 0; i < messages.length; i += 10) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: process.env.FORECAST_QUEUE_URL,
        Entries: messages.slice(i, i + 10).map((m, j) => ({ Id: String(j), MessageBody: JSON.stringify(m) })),
      }),
    );
  }
  log("info", "daily fan-out", { users: users.size });
}

export async function handler(event: SQSEvent | { mode: "daily" }): Promise<SQSBatchResponse | void> {
  if ("mode" in event) return fanOut();
  // One recompute per distinct user in the batch (debounce, research R5).
  const byUser = new Map<string, { msg: RecomputeUser; ids: string[] }>();
  for (const r of event.Records) {
    const msg = JSON.parse(r.body) as RecomputeUser;
    const e = byUser.get(msg.userId);
    if (e) e.ids.push(r.messageId), msg.changedAt > e.msg.changedAt && (e.msg = msg);
    else byUser.set(msg.userId, { msg, ids: [r.messageId] });
  }
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const { msg, ids } of byUser.values()) {
    try {
      await recompute(msg.userId, msg.correlationId);
    } catch (err) {
      log("error", "recompute failed", { correlationId: msg.correlationId, userId: msg.userId, ...errorFields(err) });
      batchItemFailures.push(...ids.map((itemIdentifier) => ({ itemIdentifier })));
    }
  }
  return { batchItemFailures };
}
