import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { ulid } from "ulid";
import { HttpError, requireOrigin, requireUser } from "./lib/auth";
import { acctSk, activePk, aggSk, ddb, forecastSk, jobSk, profileSk, queryAll, TABLE, txnSk, userPk, type Item } from "./lib/db";
import { errorFields, log, withCorrelation } from "./lib/log";
import { MAX_ABS_MINOR } from "./lib/money";
import { antExpenses, DEFAULT_ANT_THRESHOLD_MINOR } from "./lib/ant";
import { localToday, summarize } from "./lib/summary";
import { toDto, toItem, validateTransactionInput, type TransactionInput } from "./lib/transactions";

const sqs = new SQSClient({});
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCOUNT_TYPES = ["checking", "credit_card", "savings"];
const SOURCES = ["simulated", "csv"];

interface Ctx {
  user: { sub: string; email?: string };
  correlationId: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: any;
}
type Result = { status: number; body?: unknown };
type Handler = (ctx: Ctx) => Promise<Result>;

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const pk = (ctx: Ctx) => userPk(ctx.user.sub);
const notFound = () => new HttpError(404, "not_found", "Not found");
const badRequest = (message: string, details?: unknown) => Object.assign(new HttpError(400, "validation_error", message), { details });
const isConditionFail = (e: any) => e?.name === "ConditionalCheckFailedException" || e?.name === "TransactionCanceledException";

async function getItem(PK: string, SK: string): Promise<Item | undefined> {
  return (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }))).Item;
}

/** Create profile on first request; refresh lastActiveAt + ACTIVE# marker at most once per day. */
async function touchProfile(ctx: Ctx): Promise<Item> {
  let profile = await getItem(pk(ctx), profileSk());
  if (!profile) {
    profile = { PK: pk(ctx), SK: profileSk(), email: ctx.user.email ?? null, displayName: "", currency: "COP", createdAt: now(), hasTransactions: false };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(PK)" })).catch((e) => {
      if (!isConditionFail(e)) throw e;
    });
  }
  if (profile.lastActiveAt?.slice(0, 10) !== today()) {
    const month = today().slice(0, 7);
    const expiresAt = Math.floor(Date.now() / 1000) + 100 * 86400;
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Update: { TableName: TABLE, Key: { PK: pk(ctx), SK: profileSk() }, UpdateExpression: "SET lastActiveAt = :t", ExpressionAttributeValues: { ":t": now() } } },
          { Put: { TableName: TABLE, Item: { PK: activePk(month), SK: userPk(ctx.user.sub), expiresAt } } },
        ],
      }),
    );
  }
  return profile;
}

/** Marks that transactions changed so Insights can show "processing" until the forecast catches up. */
const markTxnChange = (ctx: Ctx) => ({
  Update: {
    TableName: TABLE,
    Key: { PK: pk(ctx), SK: profileSk() },
    UpdateExpression: "SET lastTxnChangeAt = :t, hasTransactions = :y",
    ExpressionAttributeValues: { ":t": now(), ":y": true },
  },
});

function txnInput(body: any): TransactionInput {
  const errors = validateTransactionInput(body);
  if (Object.keys(errors).length) throw badRequest("Invalid transaction", errors);
  return { date: body.date, amountMinor: body.amountMinor, type: body.type, category: body.category, description: body.description, accountId: body.accountId ?? null };
}

function requireDate(q: string | undefined): string {
  if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q)) throw badRequest("date query parameter is required (YYYY-MM-DD)");
  return q;
}

const isName = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.length <= 60;
const isPositiveAmount = (v: unknown) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_ABS_MINOR;
const INCOME_KINDS = ["allowance", "salary", "scholarship", "other"];

function incomeInput(b: any) {
  if (!isName(b?.name)) throw badRequest("name must be 1–60 chars");
  if (!INCOME_KINDS.includes(b.kind)) throw badRequest(`kind must be one of ${INCOME_KINDS.join(", ")}`);
  if (!isPositiveAmount(b.amountMinor)) throw badRequest("amountMinor must be a positive integer");
  const dayOfMonth = b.dayOfMonth ?? 1;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) throw badRequest("dayOfMonth must be 1–31");
  // month (YYYY-MM) marks a one-off income that counts only in that month; null = every month.
  const month = b.month ?? null;
  if (month !== null && (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw badRequest("month must be YYYY-MM");
  return { name: b.name.trim(), kind: b.kind, amountMinor: b.amountMinor, dayOfMonth, month };
}

function goalInput(b: any) {
  if (!isName(b?.name)) throw badRequest("name must be 1–60 chars");
  if (!isPositiveAmount(b.targetMinor)) throw badRequest("targetMinor must be a positive integer");
  if (typeof b.monthly !== "boolean") throw badRequest("monthly must be a boolean");
  if (!b.monthly && (typeof b.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.targetDate))) throw badRequest("targetDate (YYYY-MM-DD) is required for non-monthly goals");
  return { name: b.name.trim(), targetMinor: b.targetMinor, monthly: b.monthly, targetDate: b.monthly ? null : b.targetDate };
}

const vaultLocked = () => new HttpError(409, "vault_transaction", "Vault movements can't be edited; use a vault withdrawal");
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[\w-]+\]$/;

const plainDto = ({ PK, SK, ...x }: Item) => x;

/** List/create/update/delete for small per-user collections stored as `<prefix><id>`. */
function crud(path: string, prefix: string, input: (body: any) => Record<string, unknown>): [string, string, Handler][] {
  return [
    ["GET", path, async (ctx) => ({ status: 200, body: (await queryAll(pk(ctx), prefix)).map(plainDto) })],
    ["POST", path, async (ctx) => {
      const fields = input(ctx.body);
      await touchProfile(ctx);
      const id = ulid();
      const item = { PK: pk(ctx), SK: prefix + id, id, ...fields, createdAt: now(), updatedAt: now() };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return { status: 201, body: plainDto(item) };
    }],
    ["PUT", `${path}/:id`, async (ctx) => {
      const fields = input(ctx.body);
      const existing = await getItem(pk(ctx), prefix + ctx.params.id);
      if (!existing) throw notFound();
      const item = { ...existing, ...fields, updatedAt: now() };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return { status: 200, body: plainDto(item) };
    }],
    ["DELETE", `${path}/:id`, async (ctx) => {
      try {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(ctx), SK: prefix + ctx.params.id }, ConditionExpression: "attribute_exists(SK)" }));
      } catch (e) {
        if (isConditionFail(e)) throw notFound();
        throw e;
      }
      return { status: 204 };
    }],
  ];
}

const accountDto = ({ PK, SK, lastCorrelationId, ...a }: Item) => a;
const jobDto = ({ PK, SK, lastCorrelationId, ...j }: Item) => j;

function newJob(ctx: Ctx, accountId: string, kind: "sync" | "csv", status: "queued" | "awaiting_upload"): Item {
  const jobId = ulid();
  return {
    PK: pk(ctx),
    SK: jobSk(jobId),
    jobId,
    accountId,
    kind,
    status,
    imported: 0,
    skipped: 0,
    rejected: 0,
    rejections: [],
    uploadKey: kind === "csv" ? `uploads/${ctx.user.sub}/${jobId}.csv` : null,
    correlationId: ctx.correlationId,
    lastCorrelationId: ctx.correlationId,
    createdAt: now(),
  };
}

async function sendIngest(message: Record<string, unknown>) {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.INGEST_QUEUE_URL, MessageBody: JSON.stringify(message) }));
}

const routes: [string, string, Handler][] = [
  // ---- profile ----
  ["GET", "/api/me", async (ctx) => {
    const { PK, SK, ...p } = await touchProfile(ctx);
    return { status: 200, body: p };
  }],
  ["PATCH", "/api/me", async (ctx) => {
    const profile = await touchProfile(ctx);
    const { displayName, currency, antThresholdMinor } = ctx.body ?? {};
    const sets: string[] = [];
    const values: Record<string, unknown> = {};
    if (displayName !== undefined) {
      if (typeof displayName !== "string" || displayName.trim().length < 1 || displayName.length > 60) throw badRequest("displayName must be 1–60 chars");
      sets.push("displayName = :d"), (values[":d"] = displayName.trim());
    }
    if (antThresholdMinor !== undefined) {
      if (!isPositiveAmount(antThresholdMinor)) throw badRequest("antThresholdMinor must be a positive integer");
      sets.push("antThresholdMinor = :a"), (values[":a"] = antThresholdMinor);
    }
    if (currency !== undefined && currency !== profile.currency) {
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw badRequest("currency must be an ISO 4217 code");
      if (profile.hasTransactions) throw new HttpError(409, "currency_locked", "Currency cannot change after the first transaction");
      sets.push("currency = :c"), (values[":c"] = currency);
    }
    if (!sets.length) return { status: 200, body: { ...profile, PK: undefined, SK: undefined } };
    const res = await ddb.send(
      new UpdateCommand({ TableName: TABLE, Key: { PK: pk(ctx), SK: profileSk() }, UpdateExpression: "SET " + sets.join(", "), ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }),
    );
    const { PK, SK, ...p } = res.Attributes!;
    return { status: 200, body: p };
  }],
  ["POST", "/api/me/consent", async (ctx) => {
    const version = ctx.body?.version;
    if (typeof version !== "string" || !/^[\w.-]{1,20}$/.test(version)) throw badRequest("version must be 1–20 chars [A-Za-z0-9_.-]");
    await touchProfile(ctx);
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(ctx), SK: profileSk() },
        UpdateExpression: "SET consentVersion = :v, consentAt = :t",
        ExpressionAttributeValues: { ":v": version, ":t": now() },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { status: 200, body: plainDto(res.Attributes!) };
  }],
  ["DELETE", "/api/me", async (ctx) => {
    // Always async: deleting thousands of items at 25 WCU exceeds the API timeout.
    await sendIngest({ kind: "deleteUser", userId: ctx.user.sub, correlationId: ctx.correlationId });
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: ctx.user.sub }));
    log("info", "user deletion queued", { correlationId: ctx.correlationId, userId: ctx.user.sub });
    return { status: 202 };
  }],

  // ---- transactions ----
  ["GET", "/api/transactions", async (ctx) => {
    const { from = "0000-00-00", to = "9999-99-99", category, type, accountId, cursor } = ctx.query;
    const filters: string[] = [];
    const values: Record<string, unknown> = { ":pk": pk(ctx), ":from": txnSk(from, ""), ":to": txnSk(to, "~") };
    const names: Record<string, string> = {};
    if (category) filters.push("category = :c"), (values[":c"] = category);
    if (type) filters.push("#t = :t"), (values[":t"] = type), (names["#t"] = "type");
    if (accountId) filters.push("accountId = :a"), (values[":a"] = accountId);
    let startKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        startKey = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        throw badRequest("invalid cursor");
      }
      if (startKey?.PK !== pk(ctx)) throw badRequest("invalid cursor");
    }
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
        FilterExpression: filters.length ? filters.join(" AND ") : undefined,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ScanIndexForward: false,
        Limit: 100,
        ExclusiveStartKey: startKey,
      }),
    );
    return {
      status: 200,
      body: {
        items: (res.Items ?? []).map(toDto),
        cursor: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url") : null,
      },
    };
  }],
  ["POST", "/api/transactions", async (ctx) => {
    await touchProfile(ctx);
    const item = toItem(ctx.user.sub, txnInput(ctx.body), "manual", ctx.correlationId);
    await ddb.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE, Item: item } }, markTxnChange(ctx)] }));
    return { status: 201, body: toDto(item) };
  }],
  ["PUT", "/api/transactions/:txnId", async (ctx) => {
    const oldSk = txnSk(requireDate(ctx.query.date), ctx.params.txnId);
    const existing = await getItem(pk(ctx), oldSk);
    if (!existing) throw notFound();
    if (existing.origin === "vault") throw vaultLocked();
    const input = txnInput(ctx.body);
    const item = { ...toItem(ctx.user.sub, input, existing.origin, ctx.correlationId, { txnId: existing.txnId, createdAt: existing.createdAt, jobId: existing.jobId, fingerprint: existing.fingerprint }) };
    const writes: any[] = [{ Put: { TableName: TABLE, Item: item } }, markTxnChange(ctx)];
    if (item.SK !== oldSk) writes.push({ Delete: { TableName: TABLE, Key: { PK: pk(ctx), SK: oldSk } } });
    await ddb.send(new TransactWriteCommand({ TransactItems: writes }));
    return { status: 200, body: toDto(item) };
  }],
  ["DELETE", "/api/transactions/:txnId", async (ctx) => {
    const sk = txnSk(requireDate(ctx.query.date), ctx.params.txnId);
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: TABLE,
                Key: { PK: pk(ctx), SK: sk },
                // Vault movements are only reversed with a withdrawal, so the vault balance stays true.
                ConditionExpression: "attribute_exists(SK) AND (attribute_not_exists(origin) OR origin <> :vault)",
                ExpressionAttributeValues: { ":vault": "vault" },
              },
            },
            markTxnChange(ctx),
          ],
        }),
      );
    } catch (e) {
      if (isConditionFail(e)) throw notFound();
      throw e;
    }
    return { status: 204 };
  }],

  // ---- accounts ----
  ["GET", "/api/accounts", async (ctx) => ({ status: 200, body: (await queryAll(pk(ctx), "ACCT#")).map(accountDto) })],
  ["POST", "/api/accounts", async (ctx) => {
    const { name, type, source } = ctx.body ?? {};
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 60) throw badRequest("name must be 1–60 chars");
    if (!ACCOUNT_TYPES.includes(type)) throw badRequest("type must be checking, credit_card or savings");
    if (!SOURCES.includes(source)) throw badRequest("source must be simulated or csv");
    await touchProfile(ctx);
    const accountId = ulid();
    const account: Item = {
      PK: pk(ctx), SK: acctSk(accountId), accountId, name: name.trim(), type, source,
      status: source === "simulated" ? "syncing" : "linked", lastSyncedAt: null, failureReason: null,
      createdAt: now(), lastCorrelationId: ctx.correlationId,
    };
    if (source === "csv") {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: account }));
      return { status: 201, body: { account: accountDto(account), job: null } };
    }
    const job = newJob(ctx, accountId, "sync", "queued");
    await ddb.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE, Item: account } }, { Put: { TableName: TABLE, Item: job } }] }));
    return { status: 202, body: { account: accountDto(account), job: jobDto(job) } };
  }],
  ["POST", "/api/accounts/:accountId/sync", async (ctx) => {
    const account = await getItem(pk(ctx), acctSk(ctx.params.accountId));
    if (!account) throw notFound();
    if (account.source !== "simulated") throw badRequest("Only simulated accounts can be synced; use CSV import");
    const job = newJob(ctx, account.accountId, "sync", "queued");
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk(ctx), SK: account.SK },
                UpdateExpression: "SET #s = :syncing, failureReason = :null, lastCorrelationId = :c",
                ConditionExpression: "attribute_exists(SK) AND #s <> :syncing",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":syncing": "syncing", ":null": null, ":c": ctx.correlationId },
              },
            },
            { Put: { TableName: TABLE, Item: job } },
          ],
        }),
      );
    } catch (e) {
      if (isConditionFail(e)) throw new HttpError(409, "already_syncing", "This account is already syncing");
      throw e;
    }
    return { status: 202, body: jobDto(job) };
  }],
  ["DELETE", "/api/accounts/:accountId", async (ctx) => {
    const account = await getItem(pk(ctx), acctSk(ctx.params.accountId));
    if (!account) throw notFound();
    const deleteTransactions = ctx.query.deleteTransactions;
    if (deleteTransactions !== "true" && deleteTransactions !== "false") throw badRequest("deleteTransactions must be true or false");
    // Queue the bulk delete before removing the account so a crash can't orphan the request.
    if (deleteTransactions === "true") await sendIngest({ kind: "deleteAccountData", userId: ctx.user.sub, accountId: account.accountId, correlationId: ctx.correlationId });
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(ctx), SK: account.SK } }));
    return { status: 204 };
  }],

  // ---- imports & jobs ----
  ["POST", "/api/imports", async (ctx) => {
    const account = await getItem(pk(ctx), acctSk(String(ctx.body?.accountId ?? "")));
    if (!account) throw notFound();
    const job = newJob(ctx, account.accountId, "csv", "awaiting_upload");
    await ddb.send(new PutCommand({ TableName: TABLE, Item: job }));
    const upload = await createPresignedPost(s3, {
      Bucket: process.env.UPLOAD_BUCKET!,
      Key: job.uploadKey,
      Conditions: [["content-length-range", 1, MAX_UPLOAD_BYTES], ["eq", "$Content-Type", "text/csv"]],
      Fields: { "Content-Type": "text/csv" },
      Expires: 300,
    });
    return { status: 201, body: { job: jobDto(job), upload } };
  }],
  ["POST", "/api/imports/:jobId/start", async (ctx) => {
    const job = await getItem(pk(ctx), jobSk(ctx.params.jobId));
    if (!job || job.kind !== "csv") throw notFound();
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk(ctx), SK: job.SK },
                UpdateExpression: "SET #s = :queued, lastCorrelationId = :c",
                ConditionExpression: "#s = :awaiting",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":queued": "queued", ":awaiting": "awaiting_upload", ":c": ctx.correlationId },
              },
            },
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk(ctx), SK: acctSk(job.accountId) },
                UpdateExpression: "SET #s = :syncing, failureReason = :null",
                ConditionExpression: "attribute_exists(SK)",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":syncing": "syncing", ":null": null },
              },
            },
          ],
        }),
      );
    } catch (e) {
      if (isConditionFail(e)) throw new HttpError(409, "already_started", "Import already started or account was removed");
      throw e;
    }
    return { status: 202, body: { ...jobDto(job), status: "queued" } };
  }],
  ["GET", "/api/jobs/:jobId", async (ctx) => {
    const job = await getItem(pk(ctx), jobSk(ctx.params.jobId));
    if (!job) throw notFound();
    return { status: 200, body: jobDto(job) };
  }],

  // ---- budget: inflows, goals, safe to spend ----
  ...crud("/api/incomes", "INCOME#", incomeInput),
  ...crud("/api/goals", "GOAL#", goalInput),
  ["GET", "/api/summary", async (ctx) => {
    const today = localToday();
    const [profile, incomes, goals, txns, vault] = await Promise.all([
      touchProfile(ctx),
      queryAll(pk(ctx), "INCOME#"),
      queryAll(pk(ctx), "GOAL#"),
      queryAll(pk(ctx), `TXN#${today.slice(0, 7)}-`, {
        ProjectionExpression: "txnId, #d, amountMinor, #t, category",
        ExpressionAttributeNames: { "#d": "date", "#t": "type" },
      }),
      getItem(pk(ctx), "VAULT"),
    ]);
    const antThresholdMinor = profile.antThresholdMinor ?? DEFAULT_ANT_THRESHOLD_MINOR;
    const ant = antExpenses(txns as any[], antThresholdMinor);
    return {
      status: 200,
      body: {
        today,
        currency: profile.currency,
        consented: Boolean(profile.consentVersion),
        onboarded: incomes.length > 0,
        vaultBalanceMinor: vault?.balanceMinor ?? 0,
        antThresholdMinor,
        ant: { count: ant.count, totalMinor: ant.totalMinor, byCategory: ant.byCategory, txnIds: ant.ids },
        ...summarize(today, incomes as any[], goals as any[], txns as any[]),
      },
    };
  }],

  // ---- vault (caja fuerte, F11): savings transactions + a balance kept in step in one transaction ----
  ["GET", "/api/vault", async (ctx) => ({ status: 200, body: { balanceMinor: (await getItem(pk(ctx), "VAULT"))?.balanceMinor ?? 0 } })],
  ...(["deposit", "withdraw"] as const).map((op): [string, string, Handler] => ["POST", `/api/vault/${op}`, async (ctx) => {
    const amountMinor = ctx.body?.amountMinor;
    if (!isPositiveAmount(amountMinor)) throw badRequest("amountMinor must be a positive integer");
    await touchProfile(ctx);
    const deposit = op === "deposit";
    const item = toItem(
      ctx.user.sub,
      { date: localToday(), amountMinor: deposit ? amountMinor : -amountMinor, type: "savings", category: "savings", description: deposit ? "Caja fuerte: depósito" : "Caja fuerte: retiro" },
      "vault",
      ctx.correlationId,
    );
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk(ctx), SK: "VAULT" },
                UpdateExpression: "ADD balanceMinor :d",
                ConditionExpression: deposit ? undefined : "balanceMinor >= :a",
                ExpressionAttributeValues: deposit ? { ":d": amountMinor } : { ":d": -amountMinor, ":a": amountMinor },
              },
            },
            { Put: { TableName: TABLE, Item: item } },
            markTxnChange(ctx),
          ],
        }),
      );
    } catch (e) {
      if (!deposit && isConditionFail(e)) throw new HttpError(409, "insufficient_vault", "Not enough money in the vault");
      throw e;
    }
    const vault = await getItem(pk(ctx), "VAULT");
    return { status: 201, body: { balanceMinor: vault?.balanceMinor ?? 0, transaction: toDto(item) } };
  }]),

  // ---- push devices (F10) ----
  ["POST", "/api/devices", async (ctx) => {
    const { token, platform } = ctx.body ?? {};
    if (typeof token !== "string" || !EXPO_TOKEN.test(token)) throw badRequest("token must be an Expo push token");
    if (platform !== "ios" && platform !== "android") throw badRequest("platform must be ios or android");
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(ctx), SK: `DEVICE#${token}`, token, platform, createdAt: now() } }));
    return { status: 201, body: { token, platform } };
  }],
  ["DELETE", "/api/devices/:token", async (ctx) => {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(ctx), SK: `DEVICE#${ctx.params.token}` } }));
    return { status: 204 };
  }],

  // ---- bug reports (F16) ----
  // Operator reads them with a table scan on begins_with(SK, "FEEDBACK#") (HANDOFF.md).
  // ponytail: no rate limit and no screenshot; add both if reports get abused or need images.
  ["POST", "/api/feedback", async (ctx) => {
    const { message, appVersion } = ctx.body ?? {};
    if (typeof message !== "string" || !message.trim() || message.length > 2000) throw badRequest("message must be 1–2000 chars");
    if (appVersion != null && (typeof appVersion !== "string" || appVersion.length > 40)) throw badRequest("appVersion must be a string of at most 40 chars");
    const createdAt = now();
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(ctx), SK: `FEEDBACK#${createdAt}`, message: message.trim(), appVersion: appVersion ?? null, createdAt } }));
    log("info", "feedback received", { correlationId: ctx.correlationId, userId: ctx.user.sub, appVersion, length: message.length });
    return { status: 201, body: { createdAt } };
  }],

  // ---- insights ----
  ["GET", "/api/insights", async (ctx) => {
    const [profile, aggs, fc] = await Promise.all([touchProfile(ctx), queryAll(pk(ctx), "AGG#"), getItem(pk(ctx), forecastSk())]);
    const months = aggs
      .sort((a, b) => (a.SK < b.SK ? -1 : 1))
      .slice(-12)
      .map(({ month, expenseMinor, savingsMinor, totals }) => ({ month, expenseMinor, savingsMinor, totals }));
    const forecast = fc
      ? { status: fc.status, historyMonths: fc.historyMonths, overall: fc.overall, byCategory: fc.byCategory, computedAt: fc.computedAt }
      : // no forecast item yet: one is coming only if transactions changed
        { status: profile.lastTxnChangeAt ? "pending" : "insufficient_history", historyMonths: 0, overall: null, byCategory: {}, computedAt: null };
    const processing = Boolean(profile.lastTxnChangeAt && (!fc || profile.lastTxnChangeAt > fc.sourceChangedAt));
    return { status: 200, body: { months, forecast, processing } };
  }],
];

// Writes need Habeas Data consent first (FR-1.2); consenting and deleting the account do not.
const CONSENT_EXEMPT = new Set(["POST /api/me/consent", "DELETE /api/me", "DELETE /api/devices/:token"]);

const compiled = routes.map(([method, path, handler]) => {
  const names: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
  return { method, path, re, names, handler };
});

function respond(status: number, body: unknown, correlationId: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", "x-correlation-id": correlationId, "cache-control": "no-store" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = event.headers ?? {};
  const correlationId = withCorrelation(headers["x-correlation-id"]);
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  try {
    requireOrigin(headers);
    const user = await requireUser(headers);
    for (const r of compiled) {
      const m = r.method === method && r.re.exec(path);
      if (!m) continue;
      if (method !== "GET" && !CONSENT_EXEMPT.has(`${method} ${r.path}`)) {
        const profile = await getItem(userPk(user.sub), profileSk());
        if (!profile?.consentVersion) throw new HttpError(403, "consent_required", "Accept the data processing policy first");
      }
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      let body: unknown;
      if (event.body) {
        try {
          body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
        } catch {
          throw badRequest("Body must be JSON");
        }
      }
      const res = await r.handler({ user, correlationId, params, query: event.queryStringParameters ?? {}, body });
      log("info", "request", { correlationId, method, route: r.path, status: res.status, userId: user.sub });
      return respond(res.status, res.body, correlationId);
    }
    throw notFound();
  } catch (err: any) {
    if (err instanceof HttpError) {
      if (err.status >= 500 || err.status === 403) log("warn", "request rejected", { correlationId, method, status: err.status });
      return respond(err.status, { error: { code: err.code, message: err.message, details: (err as any).details } }, correlationId);
    }
    log("error", "request failed", { correlationId, method, path, ...errorFields(err) });
    return respond(500, { error: { code: "internal", message: "Something went wrong" } }, correlationId);
  }
}
