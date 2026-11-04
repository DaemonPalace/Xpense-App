import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME ?? "FinanceTable";
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: Number(process.env.DDB_MAX_ATTEMPTS ?? 3) }), { marshallOptions: { removeUndefinedValues: true } });

export const userPk = (sub: string) => `USER#${sub}`;
export const profileSk = () => "PROFILE";
export const acctSk = (id: string) => `ACCT#${id}`;
export const jobSk = (id: string) => `JOB#${id}`;
export const rawSk = (jobId: string, n: number) => `RAW#${jobId}#${String(n).padStart(4, "0")}`;
export const txnSk = (date: string, id: string) => `TXN#${date}#${id}`;
export const aggSk = (month: string) => `AGG#${month}`;
export const forecastSk = () => "FORECAST";
export const activePk = (yyyymm: string) => `ACTIVE#${yyyymm}`;

export type Item = Record<string, any>;

export async function queryAll(pk: string, skPrefix: string, extra: Partial<QueryCommandInput> = {}): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        // DynamoDB rejects an empty string in a key condition, so "" means "all items of pk".
        KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
        ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
        ExclusiveStartKey,
        ...extra,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** BatchWrite in chunks of 25, retrying UnprocessedItems with back-off (25 WCU table, research R6). */
export async function batchWriteAll(requests: Item[]): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length; attempt++) {
      if (attempt >= 8) throw new Error(`batchWriteAll: ${pending.length} items unprocessed after retries`);
      if (attempt) await sleep(Math.min(2000, 50 * 2 ** attempt));
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending } }));
      pending = (res.UnprocessedItems?.[TABLE] as Item[]) ?? [];
    }
  }
}

export const putReq = (Item: Item) => ({ PutRequest: { Item } });
export const delReq = (PK: string, SK: string) => ({ DeleteRequest: { Key: { PK, SK } } });
