# Queue & Worker Contracts

No EventBridge custom events (research R2). All asynchronous work flows:

```
API ──writes──▶ DynamoDB ──stream──▶ stream-router ──▶ ingest-queue   ──▶ ingest-worker
                                                   └─▶ forecast-queue ──▶ forecast-worker
EventBridge Scheduler (daily, free) ──invoke──▶ forecast-worker (fan-out mode)
```

Every message carries `userId` (Cognito sub) and `correlationId`. Consumers MUST be idempotent
(constitution II).

## stream-router

Source: DynamoDB stream of `FinanceTable` (`NEW_AND_OLD_IMAGES`), batch 100, window 60 s,
3 retries, bisect on error, on-failure destination `stream-dlq`.

| Stream record | Output |
|---|---|
| `JOB#…` whose new image has `status = queued` and old image is absent or not `queued` | one `IngestJob` message → `ingest-queue` |
| Any change to `TXN#…` | one `RecomputeUser` message per distinct user in the batch → `forecast-queue` |
| Anything else | ignored |

`correlationId` comes from the item's `lastCorrelationId` attribute (newest record per user wins).

## Messages

### `IngestJob` → `ingest-queue`
```json
{ "kind": "sync", "userId": "…", "correlationId": "…", "accountId": "01J…", "jobId": "01J…" }
{ "kind": "csv",  "userId": "…", "correlationId": "…", "accountId": "01J…", "jobId": "01J…", "uploadKey": "uploads/<sub>/<jobId>.csv" }
{ "kind": "deleteUser", "userId": "…", "correlationId": "…" }
{ "kind": "deleteAccountData", "userId": "…", "accountId": "01J…", "correlationId": "…" }
```
`deleteUser` and `deleteAccountData` are the only API → SQS writes (bulk deletes exceed the API
timeout at 25 WCU). The API sends them before deleting the Cognito user / account item, so a
failed send returns an error and the user can retry.

### `RecomputeUser` → `forecast-queue`
```json
{ "userId": "…", "correlationId": "…", "changedAt": "2026-10-24T12:00:00Z" }
```
`changedAt` = newest `ApproximateCreationDateTime` of that user's records in the batch.

## Queues

| Queue | Consumer | Batch | Window | Max concurrency | Visibility | DLQ |
|---|---|---|---|---|---|---|
| `ingest-queue` | `ingest-worker` | 1 | 0 s | 2 | 30 min (6 × 5 min timeout) | `ingest-dlq`, maxReceive 3, 14 d |
| `forecast-queue` | `forecast-worker` | 100 | 60 s | 2 | 12 min (6 × 2 min timeout) | `forecast-dlq`, maxReceive 3, 14 d |

Workers return `batchItemFailures` for partial failure. Replay: `aws sqs start-message-move-task`.

## Worker contracts

- **ingest-worker** (`IngestJob`): set job `running` → produce raw rows (simulator or S3 CSV
  stream) → store `RAW` chunks → validate/normalize/categorize → conditional put transactions
  (duplicates counted as `skipped`) → set job `succeeded`, account `synced` + `lastSyncedAt`.
  On the 3rd receive, set job/account `failed` with a reason before throwing. Re-delivery of a
  `succeeded` job is a no-op. Later status changes (`running`, `succeeded`, `failed`) don't match the router rule.
- **forecast-worker**:
  - `RecomputeUser`: skip if `PROFILE` is gone (user deleted); else read
    `PROFILE.lastTxnChangeAt`, query all `TXN#` items → write all `AGG#` items (deleting stale
    months) + `FORECAST` with `sourceChangedAt = lastTxnChangeAt` (research R10). Always
    recomputes (cheap at this scale); stream timestamps have 1-second precision, so a skip check
    could miss same-second changes. Its own writes are `AGG#` /
    `FORECAST`, so the router ignores them (no loop).
  - Scheduler fan-out (`{ "mode": "daily" }`): query the last 3 `ACTIVE#<yyyy-mm>` partitions,
    send one `RecomputeUser` per distinct user (`changedAt` = now) to `forecast-queue`.
