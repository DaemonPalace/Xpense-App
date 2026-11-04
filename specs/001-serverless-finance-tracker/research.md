# Phase 0 Research: Serverless Personal Finance Tracker

All Technical Context unknowns resolved below. Format: Decision / Rationale / Alternatives.

## R1. Which Free Tier actually applies

- **Decision**: Design against **Always Free** allowances only. Treat 12-month trial offers as
  unavailable.
- **Rationale**: Accounts created on or after 2025-07-15 no longer get the 12-month free tier;
  they get a credit-based Free/Paid plan (up to $200 credits, Free plan ends after 6 months).
  Always Free allowances apply under both plans and never expire.
- **Always Free allowances relied on** (verify on aws.amazon.com/free before deploy):
  | Service | Allowance | Our budget at 100 MAU |
  |---|---|---|
  | Lambda | 1M requests + 400k GB-s / month | ~15k requests, ~2k GB-s |
  | DynamoDB | 25 GB, 25 RCU + 25 WCU provisioned, Streams reads by Lambda free | <100 MB, 25/25 |
  | SQS | 1M requests / month | ~6k |
  | Cognito (Lite/Essentials) | 10,000 MAU | 100 |
  | CloudFront | 1 TB out, 10M requests / month | <1 GB, <50k |
  | CloudWatch | 5 GB logs ingest+storage, 10 alarm metrics, 10 custom metrics | <100 MB, 9 alarm metrics |
  | EventBridge Scheduler | 14M invocations / month | 30 |
  | AWS Budgets | 2 budgets | 1 |
- **Alternatives**: Relying on the 12-month tier — rejected, not offered to new accounts.

## R2. EventBridge: custom events dropped, Scheduler kept

- **Finding**: Custom events published to an event bus cost $1.00 per million, with no free
  allowance. EventBridge Scheduler has a free allowance (14M invocations/month).
- **Decision**: **No custom events and no custom event bus.** Change propagation uses DynamoDB
  Streams → a `stream-router` Lambda → SQS (R4). EventBridge is used only for the **Scheduler**
  (daily forecast refresh, ~30 invocations/month, free).
- **Rationale**: Requester rule: only usage covered by a free allowance. Streams reads by a
  Lambda trigger are free; SQS has 1M free requests.
- **Alternatives**: Batched custom events (~$0.0012/month at 100 users) — rejected by the
  requester. EventBridge Pipes (Streams → SQS without code) — rejected, $0.40/M with no free
  allowance.

## R3. HTTP API entry point

- **Decision**: **Lambda Function URL** (auth type `NONE`) behind **CloudFront** at path
  `/api/*`; the function verifies the Cognito access token (JWT signature, issuer, client id,
  `token_use=access`, expiry) on every request with `aws-jwt-verify`.
- **Rationale**: API Gateway's free allowance is a 12-month trial (R1); Function URLs cost
  nothing beyond Lambda requests. Same origin as the SPA, so no CORS.
- **Alternatives**: API Gateway HTTP API with a Cognito JWT authorizer — cleaner, but ~$1/M
  requests without a trial. Function URL + CloudFront OAC with IAM auth — rejected: OAC needs
  clients to send a payload hash on POST/PUT, more client complexity.
- **Mitigation**: CloudFront forwards a secret origin header; the function rejects requests
  without it, so the raw Function URL can't be called directly.

## R4. Event pipeline shape

- **Decision**:
  1. The API writes to DynamoDB only, never to a queue (no dual write). A sync or import request
     is just a `JOB#` item reaching status `queued` (sync jobs insert as `queued`; CSV jobs
     move `awaiting_upload` → `queued` after upload).
  2. DynamoDB Streams → `stream-router` Lambda (batch 100, 60 s window). It routes by key
     prefix:
     - `JOB#` transitioning to `queued` → one `ingest-queue` message per job.
     - `TXN#` insert/modify/remove → one `forecast-queue` message per user per batch.
     The stream acts as the outbox: no lost work if the API crashes after writing.
  3. SQS standard queues (`ingest-queue`, `forecast-queue`), each with a DLQ
     (`maxReceiveCount: 3`, 14-day retention). Stream-router failures go to a third DLQ
     (`stream-dlq`, the event source's on-failure destination, after 3 retries).
  4. SQS → Lambda workers with `maximumConcurrency: 2` and partial batch failure reporting.
- **Rationale**: Satisfies FR-020/021/022 using only free allowances; the stream gives
  at-least-once change capture.
- **Alternatives**: SQS FIFO with content dedup for debouncing — rejected, dedup drops changes
  that arrive after the first message within its 5-minute window. Stream event source straight
  into workers (no SQS) — rejected, the requester mandated queues and stream retries block the
  shard.

## R5. Debouncing forecast recalculation (FR-026, SC-005)

- **Decision**: `forecast-queue` event source with `batchSize: 100`,
  `maxBatchingWindow: 60 s`; the worker de-duplicates userIds within a batch and recomputes
  each user fully (no skip check: stream timestamps are 1-second precision). An EventBridge
  Scheduler schedule (daily 02:00 UTC, free allowance) invokes `forecast-worker` directly in
  fan-out mode, which enqueues users active in the last 90 days.
- **Rationale**: Full recompute per user is cheap (≤ ~5k transactions in one query) and
  naturally idempotent.
- **Current-month totals (SC-002, < 10 s)**: The async path takes up to about 2 minutes (60 s
  stream window + 60 s queue window), which is too slow. The transactions page therefore
  computes current-month totals in the SPA from the month's transactions it already fetched
  (`GET /api/transactions?from=<month start>`). Stored aggregates serve only the Insights view.
  This is instant and needs no extra writes or events.

## R6. DynamoDB capacity mode

- **Decision**: **Provisioned** single table, 25 RCU / 25 WCU, no GSIs, no auto scaling.
  Workers use `BatchWriteItem` with retry/back-off on unprocessed items.
- **Rationale**: On-demand has no Always Free allowance. Auto scaling creates CloudWatch alarms
  that eat the 10 free alarm metrics.
- **Throughput check** (per sync, independent of user count): 1,000-row sync ≈ 1,000 WCU + ~3 raw-chunk items ≈ 42 s at 25 WCU,
  helped by burst capacity (up to 300 s of unused capacity). Meets SC-003 (60 s).
- **Alternatives**: On-demand (simpler, but billed per request); multi-table (splits the free
  capacity).

## R7. CSV upload path

- **Decision**: The SPA requests a presigned S3 PUT URL (`POST /imports`). The browser uploads
  to a private `uploads` bucket (lifecycle delete after 1 day, 5 MB max enforced with
  `content-length-range` in a presigned POST). The import `JOB#` item starts `awaiting_upload` and moves
  to `queued` only after the client confirms the upload; the stream routes it to `ingest-queue`. The worker streams, parses, and stores raw rows as chunked
  `RAW` items (~300 KB each) in DynamoDB.
- **Rationale**: Lambda payloads (6 MB) and queue messages are too small for 5 MB files
  once encoded. S3 costs here are fractions of a cent.
- **Cost note**: S3 has no Always Free tier: ~$0.0001/month storage + ~$0.005/1k PUTs.
  Accepted under constitution v2.0.0 (S3 is a free-tier service).
- **Alternatives**: Browser parses CSV and posts JSON — rejected, the spec routes parsing
  through the queue and the server must validate anyway.

## R8. Simulated bank connection

- **Decision**: Deterministic generator seeded by `accountId`. On first sync it emits 6 months
  of history; later syncs emit days since `lastSyncedAt`. Each row gets a stable
  `externalId = hash(accountId, date, seq)`.
- **Rationale**: Repeatable tests; re-syncs are naturally idempotent (FR-015). No credentials
  (FR-019).

## R9. De-duplication

- **Decision**: Fingerprint = SHA-256 of `accountId|externalId` (sync) or
  `accountId|date|amountMinor|normalizedDescription|occurrenceIndex` (CSV). Transaction key
  includes the fingerprint, so `PutItem` with `attribute_not_exists(SK)` rejects duplicates
  atomically.
- **Rationale**: Uses the DB constraint instead of a read-then-write check. The
  `occurrenceIndex` keeps two identical legitimate rows in one file distinct.

## R10. Forecast method (FR-024/025)

- **Decision**: Per category and overall:
  1. Take up to the last 6 complete months of expense totals (minimum 2).
  2. Outlier dampening: clamp each month to `median × 2`.
  3. Linearly weighted moving average (oldest weight 1 … newest weight n).
  4. Next-3-months forecast = 3 × next-month forecast.
  5. Store `historyMonths` used.
- **Rationale**: Explainable, deterministic, testable with fixtures; meets the SC-006 target on
  stable data.
- **Alternatives**: Linear regression or seasonal models — rejected for v1, too unstable with
  2–6 points.

## R11. Authentication client

- **Decision**: Cognito user pool (Essentials/Lite tier), app client without a secret, SRP
  auth. Uses `amazon-cognito-identity-js` in the SPA (sign-up, confirm, SRP sign-in, refresh,
  forgot password). Access token 60 min, refresh 30 days. Advanced security off (paid).
  Cognito's built-in lockout covers throttling (FR-006). User-existence errors are suppressed
  (`preventUserExistenceErrors`).
- **Email**: The Cognito default sender is free but capped at 50 emails/day. That's fine for
  v1; switch to SES if signups exceed it.
- **Note**: The current free tier is **10k MAU** (spec and constitution v2.0.0 updated from
  50k). 100-user demo uses 1%.

## R12. Language, tooling, IaC

- **Decision**: TypeScript everywhere.
  - Lambda on Node.js 22.x, arm64, 256 MB, bundled with esbuild via CDK `NodejsFunction`.
  - AWS CDK v2 (TypeScript) for infrastructure.
  - React 18 + Vite SPA.
  - Vitest for unit tests; integration tests run against a deployed dev stack.
- **Rationale**: One language for infra, backend and frontend. `cdk deploy` is the single
  deploy command (constitution V).
- **Alternatives**: SAM/YAML (no shared types); Python Lambdas (two languages).

## R13. Observability within 10 free alarm metrics

- **Decision**:
  - Lambda JSON log format (native), 14-day log retention.
  - A tiny `log()` helper always includes `correlationId`, which comes from the request header
    `x-correlation-id` (generated if absent), is stored on the written item
    (`lastCorrelationId`), and is copied into the SQS message by `stream-router`.
  - Alarms (9 metrics), sent to one SNS email topic:
    - 1 metric-math alarm on the sum of `Errors` across 4 functions (4 metrics)
    - 1 metric-math alarm on visible messages across the 3 DLQs (3 metrics)
    - 1 metric-math alarm on DynamoDB `ReadThrottleEvents + WriteThrottleEvents` (2 metrics)
  - AWS Budgets: 1 cost budget alerting at actual > $0.05 and forecast > $0.10 (matches the
    constitution ceiling).
  - Free-tier usage: the single built-in AWS Free Tier usage alert (85% of any service's
    allowance, AWS-fixed, email). Accepted by requester in place of per-service 80% alarms.
- **Rationale**: Covers FR-029–032 inside the free alarm count (9 of 10 metrics).

## R14. Concurrency limits on new accounts

- **Finding**: New accounts may have a Lambda concurrency quota as low as 10, which blocks
  reserved concurrency.
- **Decision**: Don't use reserved concurrency. Cap workers with the SQS event source
  `maximumConcurrency: 2`. Rely on CloudFront plus JWT checks for the API.
