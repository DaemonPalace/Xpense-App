/**
 * Wires the real Lambda handlers together the way AWS does in production:
 *   api ─▶ DynamoDB Local ─▶ stream ─▶ stream-router ─▶ queues ─▶ ingest-worker / forecast-worker
 * Only the outer clients are stubbed: SQS (in-memory queues with SQS retry/DLQ semantics),
 * S3 (in-memory uploads), Cognito (token "Bearer <sub>" is accepted as user <sub>) and Expo push (fetch).
 */
import { vi } from "vitest";
import type { DynamoDBRecord, SQSEvent } from "aws-lambda";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DescribeStreamCommand, DynamoDBStreamsClient, GetRecordsCommand, GetShardIteratorCommand } from "@aws-sdk/client-dynamodb-streams";
import { SQSClient } from "@aws-sdk/client-sqs";
import { S3Client } from "@aws-sdk/client-s3";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { ulid } from "ulid";

// ---- outer-boundary stubs (installed before the handlers are imported) ----
vi.spyOn(CognitoJwtVerifier, "create").mockReturnValue({ verify: async (token: string) => ({ sub: token }) } as any);
vi.spyOn(CognitoIdentityProviderClient.prototype, "send").mockResolvedValue({} as never);

type QueueMsg = { body: string; receiveCount: number };
export const queues: Record<string, QueueMsg[]> = { ingest: [], forecast: [] };
export const dlq: Record<string, string[]> = { ingest: [], forecast: [] };
const queueName = (url?: string) => (url === process.env.INGEST_QUEUE_URL ? "ingest" : "forecast");
vi.spyOn(SQSClient.prototype, "send").mockImplementation(async (cmd: any) => {
  const q = queues[queueName(cmd.input.QueueUrl)];
  if (cmd.constructor.name === "SendMessageCommand") q.push({ body: cmd.input.MessageBody, receiveCount: 0 });
  else for (const e of cmd.input.Entries) q.push({ body: e.MessageBody, receiveCount: 0 });
  return { Failed: [] } as never;
});

export const uploads = new Map<string, string>();
vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: any) => {
  const text = uploads.get(cmd.input.Key);
  if (text === undefined) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  return { Body: { transformToString: async () => text } } as never;
});

export const pushes: { to: string; title: string }[] = [];
vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
  const msgs = JSON.parse(String(init.body)) as { to: string; title: string }[];
  pushes.push(...msgs);
  return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }), { status: 200 });
});

const { handler: apiHandler } = await import("../../src/api");
const { handler: streamHandler } = await import("../../src/stream-router");
const { handler: ingestHandler } = await import("../../src/ingest-worker");
const { handler: forecastHandler } = await import("../../src/forecast-worker");

// ---- API client ----
export const newUser = () => `it-${ulid()}`;

export function client(sub: string) {
  return async (method: string, url: string, body?: unknown) => {
    const [rawPath, qs] = url.split("?");
    const res = await apiHandler({
      rawPath,
      headers: { authorization: `Bearer ${sub}`, "x-origin-secret": process.env.ORIGIN_SECRET },
      queryStringParameters: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      requestContext: { http: { method } },
    } as any);
    return { status: res.statusCode!, body: res.body ? JSON.parse(res.body) : undefined };
  };
}

/** Signs up a user and accepts the data policy, like the app's onboarding. */
export async function consentedUser() {
  const sub = newUser();
  const call = client(sub);
  await call("POST", "/api/me/consent", { version: "2026-11" });
  return { sub, call };
}

// ---- DynamoDB stream reader ----
const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB;
const streams = new DynamoDBStreamsClient({ endpoint });
const streamArn = (await new DynamoDBClient({ endpoint }).send(new DescribeTableCommand({ TableName: process.env.TABLE_NAME }))).Table!.LatestStreamArn!;
const iterators = new Map<string, string | null>(); // shardId → next iterator (null = shard closed and drained)

async function shardIterator(ShardId: string, type: "LATEST" | "TRIM_HORIZON") {
  return (await streams.send(new GetShardIteratorCommand({ StreamArn: streamArn, ShardId, ShardIteratorType: type }))).ShardIterator ?? null;
}

async function readStream(): Promise<DynamoDBRecord[]> {
  const { StreamDescription } = await streams.send(new DescribeStreamCommand({ StreamArn: streamArn }));
  const out: DynamoDBRecord[] = [];
  for (const { ShardId } of StreamDescription?.Shards ?? []) {
    if (!iterators.has(ShardId!)) iterators.set(ShardId!, await shardIterator(ShardId!, "TRIM_HORIZON"));
    let it = iterators.get(ShardId!);
    while (it) {
      const res = await streams.send(new GetRecordsCommand({ ShardIterator: it }));
      for (const r of res.Records ?? []) {
        const t = r.dynamodb?.ApproximateCreationDateTime as unknown as Date | undefined;
        // Lambda delivers epoch seconds; the SDK hands back a Date.
        out.push({ ...r, dynamodb: { ...r.dynamodb, ApproximateCreationDateTime: t ? t.getTime() / 1000 : undefined } } as DynamoDBRecord);
      }
      it = res.NextShardIterator ?? null;
      if (!res.Records?.length) break;
    }
    iterators.set(ShardId!, it ?? null);
  }
  return out;
}

/** Skip everything already in the stream (earlier test files share the table). */
export async function skipToLatest() {
  const { StreamDescription } = await streams.send(new DescribeStreamCommand({ StreamArn: streamArn }));
  for (const { ShardId } of StreamDescription?.Shards ?? []) iterators.set(ShardId!, await shardIterator(ShardId!, "LATEST"));
  queues.ingest.length = queues.forecast.length = 0;
}

const MAX_RECEIVES = 3; // infra/stack.ts maxReceiveCount

async function deliver(name: "ingest" | "forecast") {
  const batch = queues[name].splice(0);
  if (!batch.length) return;
  const event: SQSEvent = {
    Records: batch.map((m, i) => ({ messageId: String(i), body: m.body, attributes: { ApproximateReceiveCount: String(++m.receiveCount) } }) as any),
  };
  const res = await (name === "ingest" ? ingestHandler(event) : forecastHandler(event));
  for (const f of res?.batchItemFailures ?? []) {
    const m = batch[Number(f.itemIdentifier)];
    if (m.receiveCount >= MAX_RECEIVES) dlq[name].push(m.body);
    else queues[name].push(m);
  }
}

/** Runs stream → router → workers until the system is quiet (what "eventually" means in production). */
export async function settle() {
  for (let round = 0; round < 20; round++) {
    const records = await readStream();
    if (records.length) await streamHandler({ Records: records } as any);
    if (!records.length && !queues.ingest.length && !queues.forecast.length) return;
    await deliver("ingest");
    await deliver("forecast");
  }
  throw new Error("pipeline did not settle in 20 rounds");
}
