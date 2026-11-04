import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { acctSk, activePk, batchWriteAll, ddb, delReq, jobSk, profileSk, putReq, queryAll, rawSk, TABLE, userPk, type Item } from "./lib/db";
import { errorFields, log } from "./lib/log";
import { generate, firstSyncStart, type AccountType } from "./lib/simulator";
import { parseImport } from "./lib/csv";
import { categorize } from "./lib/categorize";
import { csvFingerprint, normalizeDescription, syncFingerprint } from "./lib/dedupe";
import { toItem, type TransactionInput } from "./lib/transactions";

const s3 = new S3Client({});
const RAW_CHUNK_BYTES = 300_000;
const MAX_RECEIVES = 3;

interface Msg {
  kind: "sync" | "csv" | "deleteUser" | "deleteAccountData";
  userId: string;
  correlationId: string;
  accountId?: string;
  jobId?: string;
  uploadKey?: string;
}

class UserFacingError extends Error {}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

async function update(PK: string, SK: string, fields: Record<string, unknown>) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(fields).map(([k, v], i) => ((names[`#f${i}`] = k), (values[`:v${i}`] = v), `#f${i} = :v${i}`));
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { PK, SK }, UpdateExpression: "SET " + sets.join(", "), ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
}

function chunkRaw(rows: unknown[]): unknown[][] {
  const chunks: unknown[][] = [];
  let cur: unknown[] = [];
  let size = 0;
  for (const r of rows) {
    const s = JSON.stringify(r).length;
    if (cur.length && size + s > RAW_CHUNK_BYTES) chunks.push(cur), (cur = []), (size = 0);
    cur.push(r), (size += s);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Existing transaction SKs in the date range — duplicates are skipped, never overwritten (keeps user edits). */
async function existingSks(PK: string, fromDate: string, toDate: string): Promise<Set<string>> {
  const sks = new Set<string>();
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
        ExpressionAttributeValues: { ":pk": PK, ":a": `TXN#${fromDate}#`, ":b": `TXN#${toDate}#~` },
        ProjectionExpression: "SK",
        ExclusiveStartKey,
      }),
    );
    for (const i of res.Items ?? []) sks.add(i.SK);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return sks;
}

async function ingest(msg: Msg, job: Item, account: Item) {
  const PK = userPk(msg.userId);
  let raw: unknown[];
  let candidates: { input: TransactionInput; fingerprint: string }[];
  let rejections: { row: number; reason: string }[] = [];

  if (msg.kind === "sync") {
    const from = account.lastSyncedAt ? account.lastSyncedAt.slice(0, 10) : firstSyncStart(today());
    const rows = generate(account.accountId, account.type as AccountType, from, today());
    raw = rows;
    candidates = rows.map((r) => ({
      fingerprint: syncFingerprint(account.accountId, r.externalId),
      input: { date: r.date, amountMinor: r.amountMinor, type: r.type, category: r.type === "savings" ? "savings" : categorize(r.description), description: r.description, accountId: account.accountId },
    }));
  } else {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.UPLOAD_BUCKET, Key: msg.uploadKey })).catch((e) => {
      if (e?.name === "NoSuchKey") throw new UserFacingError("Uploaded file not found — upload it again");
      throw e;
    });
    const text = await obj.Body!.transformToString("utf-8");
    let parsed;
    try {
      parsed = parseImport(text);
    } catch (e) {
      throw new UserFacingError((e as Error).message);
    }
    if (process.env.ALLOW_POISON === "true" && parsed.rows.some((r) => r.description === "__POISON__")) throw new Error("poison row (test only)");
    raw = parsed.rows.map((r) => r.raw);
    rejections = parsed.rejections;
    const seen = new Map<string, number>();
    candidates = parsed.rows.map((r) => {
      const key = `${r.date}|${r.amountMinor}|${normalizeDescription(r.description)}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      const category = r.category ?? categorize(r.description);
      return {
        fingerprint: csvFingerprint(account.accountId, r.date, r.amountMinor, r.description, occurrence),
        input: { date: r.date, amountMinor: r.amountMinor, type: category === "savings" ? "savings" : "expense", category, description: r.description, accountId: account.accountId },
      };
    });
  }

  await batchWriteAll(chunkRaw(raw).map((rows, n) => putReq({ PK, SK: rawSk(job.jobId, n), jobId: job.jobId, accountId: account.accountId, rows })));

  let toWrite: Item[] = [];
  let skipped = 0;
  if (candidates.length) {
    const dates = candidates.map((c) => c.input.date).sort();
    const existing = await existingSks(PK, dates[0], dates[dates.length - 1]);
    for (const c of candidates) {
      const item = toItem(msg.userId, c.input, msg.kind === "sync" ? "sync" : "csv", msg.correlationId, { txnId: c.fingerprint, fingerprint: c.fingerprint, jobId: job.jobId });
      if (existing.has(item.SK)) skipped++;
      else existing.add(item.SK), toWrite.push(item);
    }
    await batchWriteAll(toWrite.map(putReq));
  }

  const finishedAt = now();
  if (toWrite.length) await update(PK, profileSk(), { lastTxnChangeAt: finishedAt, hasTransactions: true });
  await update(PK, job.SK, { status: "succeeded", imported: toWrite.length, skipped, rejected: rejections.length, rejections: rejections.slice(0, 50), finishedAt });
  await update(PK, account.SK, { status: "synced", lastSyncedAt: finishedAt, failureReason: null });
  log("info", "ingest succeeded", { correlationId: msg.correlationId, jobId: job.jobId, imported: toWrite.length, skipped, rejected: rejections.length });
}

async function deleteKeys(items: Item[]) {
  await batchWriteAll(items.map((i) => delReq(i.PK, i.SK)));
}

async function deleteUser(msg: Msg) {
  const PK = userPk(msg.userId);
  // Profile first, so forecast-worker stops recomputing for this user while the rest is deleted.
  await deleteKeys([{ PK, SK: profileSk() }]);
  await deleteKeys(await queryAll(PK, "", { ProjectionExpression: "PK, SK" }));
  const d = new Date();
  const markers = [0, 1, 2, 3].map((n) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 7);
    return { PK: activePk(m), SK: PK };
  });
  await deleteKeys(markers);
  log("info", "user deleted", { correlationId: msg.correlationId, userId: msg.userId });
}

async function deleteAccountData(msg: Msg) {
  const PK = userPk(msg.userId);
  const txns = await queryAll(PK, "TXN#", { ProjectionExpression: "PK, SK, accountId" });
  const jobs = await queryAll(PK, "JOB#", { ProjectionExpression: "PK, SK, jobId, accountId" });
  const mine = jobs.filter((j) => j.accountId === msg.accountId);
  const raws = (await Promise.all(mine.map((j) => queryAll(PK, `RAW#${j.jobId}#`, { ProjectionExpression: "PK, SK" })))).flat();
  await deleteKeys([...txns.filter((t) => t.accountId === msg.accountId), ...raws, ...mine]);
  log("info", "account data deleted", { correlationId: msg.correlationId, accountId: msg.accountId });
}

async function processRecord(record: SQSRecord) {
  const msg = JSON.parse(record.body) as Msg;
  if (msg.kind === "deleteUser") return deleteUser(msg);
  if (msg.kind === "deleteAccountData") return deleteAccountData(msg);

  const PK = userPk(msg.userId);
  const job = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: jobSk(msg.jobId!) } }))).Item;
  if (!job || job.status === "succeeded") return log("info", "job already done or missing", { correlationId: msg.correlationId, jobId: msg.jobId });
  const account = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: acctSk(msg.accountId!) } }))).Item;
  if (!account) {
    await update(PK, job.SK, { status: "failed", failureReason: "Account was removed", finishedAt: now() });
    return;
  }
  await update(PK, job.SK, { status: "running", startedAt: now() });
  try {
    await ingest(msg, job, account);
  } catch (err) {
    const userFacing = err instanceof UserFacingError;
    const finalAttempt = userFacing || Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVES;
    log("error", "ingest failed", { correlationId: msg.correlationId, jobId: msg.jobId, finalAttempt, ...errorFields(err) });
    if (finalAttempt) {
      const reason = userFacing ? (err as Error).message : "Processing failed after several attempts. Please retry.";
      await update(PK, job.SK, { status: "failed", failureReason: reason, finishedAt: now() });
      await update(PK, account.SK, { status: "failed", failureReason: reason });
    }
    if (!userFacing) throw err; // let SQS retry → DLQ; bad files are final, no retry needed
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      log("error", "record failed", { messageId: record.messageId, ...errorFields(err) });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

