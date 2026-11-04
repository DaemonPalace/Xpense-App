import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { errorFields, log } from "./lib/log";

const sqs = new SQSClient({});

export interface Routed {
  ingest: Record<string, unknown>[];
  forecast: Record<string, unknown>[];
}

const img = (r: DynamoDBRecord, which: "NewImage" | "OldImage") => {
  const raw = r.dynamodb?.[which];
  return raw ? unmarshall(raw as any) : undefined;
};

/** Pure routing per contracts/queues.md. */
export function route(records: DynamoDBRecord[]): Routed {
  const ingest: Record<string, unknown>[] = [];
  const users = new Map<string, { changedAt: string; correlationId?: string }>();
  for (const r of records) {
    const keys = r.dynamodb?.Keys ? unmarshall(r.dynamodb.Keys as any) : {};
    const PK = String(keys.PK ?? "");
    const SK = String(keys.SK ?? "");
    if (!PK.startsWith("USER#")) continue;
    const userId = PK.slice(5);
    const next = img(r, "NewImage");
    const prev = img(r, "OldImage");

    if (SK.startsWith("JOB#")) {
      if (next?.status === "queued" && prev?.status !== "queued") {
        ingest.push({ kind: next.kind, userId, correlationId: next.lastCorrelationId ?? next.correlationId, accountId: next.accountId, jobId: next.jobId, uploadKey: next.uploadKey ?? undefined });
      }
    } else if (SK.startsWith("TXN#")) {
      const changedAt = new Date((r.dynamodb?.ApproximateCreationDateTime ?? Date.now() / 1000) * 1000).toISOString();
      const prevUser = users.get(userId);
      if (!prevUser || changedAt >= prevUser.changedAt) {
        users.set(userId, { changedAt, correlationId: (next ?? prev)?.lastCorrelationId ?? prevUser?.correlationId });
      }
    }
  }
  const forecast = [...users].map(([userId, u]) => ({ userId, correlationId: u.correlationId, changedAt: u.changedAt }));
  return { ingest, forecast };
}

async function sendAll(queueUrl: string | undefined, messages: Record<string, unknown>[]) {
  for (let i = 0; i < messages.length; i += 10) {
    const res = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: messages.slice(i, i + 10).map((m, j) => ({ Id: String(j), MessageBody: JSON.stringify(m) })),
      }),
    );
    if (res.Failed?.length) throw new Error(`SendMessageBatch failed for ${res.Failed.length} messages`);
  }
}

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const { ingest, forecast } = route(event.Records);
  try {
    await sendAll(process.env.INGEST_QUEUE_URL, ingest);
    await sendAll(process.env.FORECAST_QUEUE_URL, forecast);
    for (const m of [...ingest, ...forecast]) log("info", "routed", { correlationId: m.correlationId as string, kind: m.kind ?? "recompute", userId: m.userId });
    return { batchItemFailures: [] };
  } catch (err) {
    // Retry the whole batch; consumers are idempotent so re-sent messages are harmless.
    log("error", "routing failed", { records: event.Records.length, ...errorFields(err) });
    const first = event.Records[0]?.dynamodb?.SequenceNumber;
    return { batchItemFailures: first ? [{ itemIdentifier: first }] : [] };
  }
}
