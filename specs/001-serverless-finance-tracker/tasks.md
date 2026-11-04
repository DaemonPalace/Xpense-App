---

description: "Task list for Serverless Personal Finance Tracker"
---

# Tasks: Serverless Personal Finance Tracker

**Input**: Design documents from `/specs/001-serverless-finance-tracker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml,
contracts/queues.md, quickstart.md

**Tests**: Constitution V requires automated tests for money and security logic (amount
handling, de-duplication, aggregation, forecasting, access scoping, cross-user access). Only
those test tasks are included. Everything else is validated by quickstart.md scenarios V1–V12.

**Organization**: Tasks are grouped by user story so each story can be built and tested on its
own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Path Conventions

Web app layout from plan.md: `infra/`, `backend/src/`, `backend/tests/`, `frontend/src/`,
`scripts/`. The single CDK stack lives in `infra/stack.ts`. Tasks that edit it are sequential.

## Global rules (apply to every task)

- TypeScript, strict mode; Node.js 22.x Lambda runtime, arm64, 256 MB.
- Amounts are integer minor units (`amountMinor`), never floats (FR-011).
- Every DynamoDB key used by the API is `PK = USER#<sub>`, with `<sub>` taken only from the
  verified token, never from the request body, path or query (constitution III).
- Every log line goes through `backend/src/lib/log.ts` and includes `correlationId`.
- No EventBridge custom events, no API Gateway, no on-demand DynamoDB, no auto scaling
  (research R2, R3, R6).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create root `package.json` with npm workspaces `["backend", "frontend"]`. Add root
  devDependencies `aws-cdk-lib@^2`, `constructs`, `aws-cdk`, `typescript@^5`, `tsx`,
  `esbuild`, `vitest`. Add scripts `test` (`vitest run --root backend`), `build`
  (`npm run build -w frontend`), `deploy` (`npm run build && cdk deploy`). Add `cdk.json` with
  `"app": "npx tsx infra/app.ts"`. Add `.gitignore` (node_modules, cdk.out, dist, .env*).
- [X] T002 [P] Create `backend/package.json`. Dependencies: `@aws-sdk/client-dynamodb`,
  `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`,
  `@aws-sdk/s3-presigned-post`, `@aws-sdk/client-cognito-identity-provider`,
  `aws-jwt-verify`, `ulid`. devDependency: `@types/aws-lambda`. Also create
  `backend/tsconfig.json` (strict, ES2022, moduleResolution bundler).
- [X] T003 [P] Scaffold `frontend/` with Vite React-TS (`npm create vite@latest frontend -- --template react-ts`).
  Add dependencies `amazon-cognito-identity-js` and `react-router-dom`. Delete the template
  demo content.
- [X] T004 [P] Create `tsconfig.json` at the repo root for `infra/`. Create `infra/app.ts`,
  which instantiates `FinanceStack` from `infra/stack.ts`, region from `CDK_DEFAULT_REGION`
  defaulting to `us-east-1`. Create an empty `FinanceStack` class in `infra/stack.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Implement `backend/src/lib/log.ts`: `log(level, message, fields)` writes one JSON
  line with `level`, `message`, `correlationId`, `component`, plus fields. Implement
  `redact()`, which removes keys `password`, `token`, `authorization`, `accessToken`,
  `refreshToken`, and masks any digit run ≥ 8 to its last 4 digits (FR-030).
  Implement `withCorrelation(id?)`, which returns the given id or a new ULID.
- [X] T006 [P] Implement `backend/src/lib/money.ts`:
  - `parseAmount(str): number` (decimal string → integer minor units, no float math, rejects
    more than 2 decimals).
  - `formatAmount(minor, currency)`.
  - `validateAmount(minor)`: rule "≠ 0; abs ≤ 100,000,000".
- [X] T007 [P] Unit tests in `backend/tests/unit/money.test.ts`: `"12.34"`→1234, `"-0.5"`→-50,
  `"0.1"+"0.2"` summed as minor equals 30, rejects `"1.234"`, `"abc"`, 0, 100,000,001.
- [X] T008 Implement `backend/src/lib/db.ts`:
  - DynamoDB DocumentClient for table `process.env.TABLE_NAME`.
  - Key helpers: `userPk(sub)`, `profileSk()`, `acctSk(id)`, `jobSk(id)`,
    `rawSk(jobId, n)`, `txnSk(date, id)`, `aggSk(month)`, `forecastSk()`,
    `activePk(yyyymm)`.
  - `queryAll(pk, skPrefix)` with pagination.
  - `batchWriteAll(requests)`: chunks of 25, retries `UnprocessedItems` with exponential
    back-off, up to 8 tries (research R6).
- [X] T009 Implement `backend/src/lib/auth.ts`:
  - `requireOrigin(headers)`: compares `x-origin-secret` to `process.env.ORIGIN_SECRET` in
    constant time, else throws 403.
  - `requireUser(headers)`: verifies the `Authorization: Bearer` token with
    `CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "access" })` and returns
    `{ sub, email }`, else throws 401 (research R3).
- [X] T010 Implement `backend/src/api.ts` as a Lambda Function URL handler.
  - Request handling: parse method and path; call `requireOrigin`, then `requireUser`;
    resolve `correlationId` from `x-correlation-id` or generate one.
  - Routing: a route table `{ "GET /api/me": handler, ... }` with `:param` matching. Handlers
    get `(req, user, correlationId)`.
  - Responses: JSON responses with an `x-correlation-id` header. Errors use the shape
    `{ "error": { "code", "message" } }` with status 400/401/403/404/409/413/500
    (contracts/openapi.yaml). 500s are logged without the request body.
  - Profile: on first request, put `PROFILE` with `currency: "USD"` and `createdAt` (create if
    missing). Update `lastActiveAt` and put `ACTIVE#<yyyy-mm>`/`USER#<sub>` with
    `expiresAt` = now + 100 days, at most once per day (data-model.md "Activity marker").
- [X] T011 Write `FinanceStack` foundations in `infra/stack.ts`.
  - **DynamoDB table** `FinanceTable`: PK/SK strings, `billingMode: PROVISIONED`,
    `readCapacity: 25`, `writeCapacity: 25`, no GSIs, no auto scaling, stream
    `NEW_AND_OLD_IMAGES`, TTL attribute `expiresAt`, `RemovalPolicy.DESTROY`.
  - **Cognito user pool**:
    - Sign-in: email sign-in, self sign-up, email verification code.
    - Password policy: min 8 characters with upper, lower, digit and symbol.
    - Tier: `featurePlan: ESSENTIALS`; advanced security off.
    - App client: no secret, `authFlows: { userSrp: true }`, access token 60 min, refresh
      token 30 days, `preventUserExistenceErrors: true` (FR-001–006, research R11).
  - **SNS topic** `alerts` with an email subscription from context `alertEmail`.
- [X] T012 Add to `infra/stack.ts`:
  - **API Lambda**: `NodejsFunction` `api` (entry `backend/src/api.ts`, nodejs22.x, arm64,
    256 MB, 10 s timeout, JSON logging format, log retention 14 days). Env: `TABLE_NAME`,
    `USER_POOL_ID`, `CLIENT_ID`, `ORIGIN_SECRET` (from context `originSecret`, or else
    `crypto.randomUUID()` at synth. CloudFront header and env update together on each deploy.
    Never logged).
  - **Function URL** with `authType: NONE`.
  - **Permissions**: grant the table read/write only.
  - **SPA bucket**: private S3 `site` bucket with Block Public Access, deployed with
    `BucketDeployment` from `frontend/dist`.
  - **CloudFront distribution**:
    - Default origin: S3 with OAC, `viewerProtocolPolicy: REDIRECT_TO_HTTPS`, SPA fallback
      (403/404 → `/index.html` 200).
    - Behavior `/api/*`: Function URL origin, custom header `x-origin-secret`, caching
      disabled, all methods allowed, origin request policy `ALL_VIEWER_EXCEPT_HOST_HEADER`.
  - **Outputs**: `SiteUrl`, `UserPoolId`, `UserPoolClientId`.
- [X] T013 Frontend shell:
  - `frontend/src/auth.ts`: `amazon-cognito-identity-js` wrappers `signUp`, `confirm`,
    `signIn` (SRP), `signOut`, `forgotPassword`, `confirmPassword`, and `getAccessToken()`,
    which refreshes when the token is within 5 min of expiry.
  - Config is read from `/config.json`, written by CDK `BucketDeployment` with `Source.jsonData`
    containing `userPoolId` and `clientId`.
- [X] T014 [P] Implement `frontend/src/api.ts`:
  - `api(method, path, body?)` adds `Authorization` and a new `x-correlation-id` per call.
  - On 401 it refreshes once, then redirects to `/signin`, saving any unsaved form draft to
    `sessionStorage` (US1 scenario 5).
  - Throws `{ code, message }` from the error body.
- [X] T015 Implement `frontend/src/main.tsx`: router with routes `/signin`, `/signup`,
  `/transactions` (default), `/accounts`, `/insights`, `/settings`; an auth guard that
  redirects to `/signin`; a responsive layout with top nav (desktop and mobile widths, FR-027).

**Checkpoint**: `npx cdk deploy` succeeds. `SiteUrl` serves the SPA shell over HTTPS.
`GET /api/me` with a valid token returns 200; without a token it returns 401; calling the raw
Function URL returns 403.

---

## Phase 3: User Story 1 - Sign up and manually track transactions (Priority: P1) 🎯 MVP

**Goal**: Users register, sign in, and create, view, edit, delete and filter their own
transactions, with current-month totals.

**Independent Test**: quickstart V1–V4.

### Tests for User Story 1 (constitution V: security + money)

- [X] T016 [P] [US1] Unit tests in `backend/tests/unit/transactions.test.ts`, covering
  `validateTransactionInput`:
  - date not more than 1 day in the future
  - `amountMinor` must satisfy "≠ 0; abs ≤ 100,000,000"
  - `type` must be `expense` or `savings`
  - `category` must be one of `housing, food, transport, utilities, entertainment, health,
    shopping, savings, other`
  - `description` must be "1–200 chars"
- [X] T017 [P] [US1] Authorization tests in `backend/tests/unit/api-authz.test.ts`. Mock the
  DocumentClient and `requireUser`, then call the api handler as user B with user A's
  `txnId`/`date`. Assert 404, and assert every DynamoDB call used `PK = USER#<B>`. Also
  assert that `userId`/`sub` fields in the body or query are ignored (SC-009).

### Implementation for User Story 1

- [X] T018 [US1] Implement `backend/src/lib/transactions.ts`:
  - `CATEGORIES` constant.
  - `validateTransactionInput(input)`, which returns errors per field using the rules in T016.
  - `toItem(sub, input, origin, correlationId)`, which builds the `TXN#<yyyy-mm-dd>#<ulid>`
    item with fields from data-model.md "Transaction", `lastCorrelationId` and timestamps.
- [X] T019 [US1] Add routes in `backend/src/api.ts`:
  - `GET /api/me` and `PATCH /api/me` (`displayName` "1–60 chars"; `currency` ISO 4217,
    "immutable after first transaction" → 409).
  - `POST /api/transactions` (201).
  - `GET /api/transactions`:
    - Query `begins_with TXN#` within the date range via
      `SK BETWEEN TXN#<from> AND TXN#<to>~`.
    - Filter on `category`, `type` and `accountId`.
    - Return newest first (`ScanIndexForward: false`), 100 per page, with a base64 cursor
      (FR-010).
  - `PUT /api/transactions/:txnId?date=`: if the date changed, `TransactWriteItems` deletes
    the old item and puts the new one; otherwise update. Missing item → 404.
  - `DELETE /api/transactions/:txnId?date=` (204/404).
- [X] T020 [P] [US1] Implement `frontend/src/pages/SignUp.tsx` (email, password with policy
  hint, confirmation code step, generic error on existing email) and
  `frontend/src/pages/SignIn.tsx` (sign in plus forgot-password flow).
- [X] T021 [US1] Implement `frontend/src/pages/Transactions.tsx`:
  - Add/edit form: amount as a decimal string parsed with a client copy of `parseAmount`
    rules, date, type, category select, description.
  - List with edit/delete and filters (date range, category, type, account).
  - Current-month expense and savings totals, computed client-side from the fetched current
    month's transactions (research R5, SC-002).
  - Restores a saved draft from `sessionStorage`.
- [X] T022 [US1] Implement `frontend/src/pages/Settings.tsx` (display name, currency) and wire
  sign-out in the layout.

**Checkpoint**: quickstart V1–V4 pass. The MVP is demoable.

---

## Phase 4: User Story 2 - Connect a simulated account and sync history (Priority: P2)

**Goal**: Link simulated accounts or upload CSV. Ingestion runs asynchronously through
stream → SQS → worker, with de-dup, categorization and per-account status.

**Independent Test**: quickstart V5–V8.

### Tests for User Story 2 (constitution V: de-dup + parsing + money)

- [X] T023 [P] [US2] Unit tests in `backend/tests/unit/dedupe.test.ts`:
  - The same sync row gives the same fingerprint.
  - Two identical CSV rows in one file get different fingerprints via `occurrenceIndex`.
  - Re-importing the same file gives the same fingerprints (research R9).
- [X] T024 [P] [US2] Unit tests in `backend/tests/unit/csv.test.ts`:
  - quoted fields, embedded commas/quotes/newlines, CRLF
  - header detection for `date,description,amount[,category]`
  - bad date, future date, zero amount and non-numeric amount → rejected with row number
  - empty file → error
- [X] T025 [P] [US2] Unit tests in `backend/tests/unit/categorize.test.ts` (keyword hits per
  category, case-insensitive, fallback `other`) and `backend/tests/unit/simulator.test.ts`
  (same `accountId` gives identical output; first sync spans 6 months; incremental sync only
  returns dates after `lastSyncedAt`).
- [X] T026 [P] [US2] Unit tests in `backend/tests/unit/stream-router.test.ts`, using stream
  record fixtures:
  - A `JOB#` INSERT with status `queued` → one ingest message.
  - A MODIFY `awaiting_upload`→`queued` → one ingest message.
  - A MODIFY `queued`→`running` → none.
  - A MODIFY `failed`→`queued` (retry) → one ingest message.
  - `AGG#`/`FORECAST` records → none.

### Implementation for User Story 2

- [X] T027 [P] [US2] Implement `backend/src/lib/dedupe.ts`:
  - `syncFingerprint(accountId, externalId)` = sha256 hex of `accountId|externalId`.
  - `csvFingerprint(accountId, date, amountMinor, description, occurrenceIndex)`, where
    `description` is normalized (lowercased, whitespace collapsed).
- [X] T028 [P] [US2] Implement `backend/src/lib/csv.ts`:
  - RFC 4180 parser (~40 lines, no dependency).
  - `parseImport(text)` → `{ rows, rejections[{row, reason}] }`. Enforces columns
    `date,description,amount[,category]`, max 10,000 rows, and the transaction validation
    rules from `lib/transactions.ts`.
- [X] T029 [P] [US2] Implement `backend/src/lib/categorize.ts`: a keyword map per default
  category (e.g. rent/mortgage→housing, grocery/restaurant→food, uber/fuel→transport,
  electric/water/internet→utilities, netflix/cinema→entertainment, pharmacy/doctor→health,
  amazon/store→shopping, transfer to savings→savings). First match wins on the lowercased
  description; otherwise `other` (FR-016).
- [X] T030 [P] [US2] Implement `backend/src/lib/simulator.ts`: seeded PRNG (mulberry32 from a
  hash of `accountId`).
  - `generate(accountId, type, fromDate, toDate)` → rows `{ externalId, date, description,
    amountMinor }`, with realistic merchants per account type and monthly rent/salary-like
    patterns.
  - `externalId` = `hash(accountId, date, seq)`.
  - First sync: from today minus 6 months (research R8).
- [X] T031 [US2] Implement `backend/src/stream-router.ts`, the DynamoDB Streams handler
  (contracts/queues.md):
  - Route each `JOB#` record whose new image has `status = queued`, and whose old image is
    absent or not `queued`, to an `IngestJob` message on `INGEST_QUEUE_URL`
    (`SendMessageBatch`).
  - Ignore other records for now (`TXN#` routing is added in T041).
  - Return `batchItemFailures` on error.
- [X] T032 [US2] Implement `backend/src/ingest-worker.ts`, the SQS handler, per
  contracts/queues.md "ingest-worker":
  - Load the job and no-op if `succeeded`; set `running`.
  - `sync`: simulator rows since `lastSyncedAt`.
  - `csv`: stream the S3 object `uploadKey` and run `parseImport`.
  - Store `RAW#<jobId>#<n>` chunks of ≤ 300 KB.
  - Categorize, then do a conditional put per transaction
    (`attribute_not_exists(SK)`, `ConditionalCheckFailed` → `skipped++`) through
    `batchWriteAll`, using `TransactWriteItems` or per-item puts for conditions.
  - Set job `succeeded` with counts and the first 50 `rejections`, and set the account
    `synced` with `lastSyncedAt`.
  - On `ApproximateReceiveCount >= 3` failure, set job and account `failed` with a
    plain-language `failureReason` before rethrowing.
  - `deleteUser` kind: delete all `USER#<sub>` items and `ACTIVE#` markers via
    `batchWriteAll`.
  - Log every step with `correlationId` from the message.
- [X] T033 [US2] Add account and import routes in `backend/src/api.ts` (contracts/openapi.yaml):
  - `GET /api/accounts`.
  - `POST /api/accounts` (`name` "1–60 chars"; `type`
    `checking | credit_card | savings`; `source` `simulated | csv`). For `simulated`, a
    `TransactWriteItems` puts the account with status `syncing` and a `JOB#` `queued` sync
    job; return 202 `{account, job}`.
  - `POST /api/accounts/:id/sync`: `TransactWriteItems` with a condition
    `status <> syncing` on the account (else 409), sets `syncing`, and puts the `JOB#`
    `queued`. This also covers retry from `failed`.
  - `DELETE /api/accounts/:id?deleteTransactions=` deletes the account. When true, it also
    deletes the `TXN#` items with that `accountId` and the `RAW#` items of its jobs.
  - `POST /api/imports` creates a `JOB#` with `awaiting_upload` and returns an S3
    presigned POST for `uploads/<sub>/<jobId>.csv` with `content-length-range` 1–5,242,880
    and Content-Type `text/csv`.
  - `POST /api/imports/:jobId/start`: conditional update `awaiting_upload`→`queued` (else
    409).
  - `GET /api/jobs/:jobId`.
- [X] T034 [US2] Add to `infra/stack.ts`:
  - **Uploads bucket**: private S3 `uploads` bucket, Block Public Access, lifecycle expire
    after 1 day, CORS POST from the CloudFront domain.
  - **Queues**: SQS `ingest-queue` (visibility 30 min) with `ingest-dlq` (maxReceiveCount 3,
    retention 14 days).
  - **`stream-router` Lambda**: `NodejsFunction`, 30 s timeout. DynamoDB event source:
    batch 100, `maxBatchingWindow` 60 s, retryAttempts 3, `bisectBatchOnError`, on-failure
    destination SQS `stream-dlq` (14 days). Env `INGEST_QUEUE_URL`.
  - **`ingest-worker` Lambda**: `NodejsFunction`, 5 min timeout. SQS event source: batch 1,
    `maxConcurrency: 2`, `reportBatchItemFailures`.
  - **Permissions** (least privilege): router `sqs:SendMessage` on ingest-queue only; worker
    table read/write plus `s3:GetObject` on uploads; api `s3:PutObject` on `uploads/*` (for
    presign) plus `sqs:SendMessage` on ingest-queue (for `deleteUser`).
  - JSON logs and 14-day retention on all functions.
- [X] T035 [US2] Implement `frontend/src/pages/Accounts.tsx`:
  - Link simulated account form (name, type).
  - Account list with status badge (`syncing`/`synced`/`failed` with `failureReason` and a
    Retry button), `lastSyncedAt`, Sync button (shows the 409 as "already syncing"), and
    Unlink with a keep/delete-transactions choice.
  - CSV upload: `POST /api/imports` → browser POST to the presigned URL → `/start` → poll
    `GET /api/jobs/:id` every 3 s until done → show imported/skipped/rejected and the
    rejection reasons.
  - Client-side pre-check: > 5 MB or non-`.csv` is rejected with a message (V8).
- [X] T036 [P] [US2] Create fixtures `backend/tests/fixtures/sample.csv` (20 valid rows
  including 2 exact duplicate rows of earlier rows from a previous import, and 1 row with an
  invalid date) and `backend/tests/fixtures/poison.csv`. The poison file contains the marker
  row `date,description,amount` → `2026-01-01,__POISON__,1.00`; `ingest-worker` throws on
  `__POISON__` only when `process.env.ALLOW_POISON === "true"` (set in the dev stack only,
  for quickstart V11).

**Checkpoint**: quickstart V5–V8 pass. US1 still works.

---

## Phase 5: User Story 3 - View spending history and expense predictions (Priority: P3)

**Goal**: Monthly aggregates per category plus next-month and 3-month forecasts, refreshed
after changes and daily.

**Independent Test**: quickstart V9–V10.

### Tests for User Story 3 (constitution V: aggregation + forecasting)

- [X] T037 [P] [US3] Unit tests in `backend/tests/unit/aggregate.test.ts`:
  `aggregate(transactions)` → per month `totals[category].{expenseMinor, savingsMinor, count}`
  and month totals. Refunds (negative expense) reduce the category total. Integer-only sums.
- [X] T038 [P] [US3] Unit tests in `backend/tests/unit/forecast.test.ts`:
  - fewer than 2 complete months → `insufficient_history`
  - a flat 6 × 1000 history → next 1000, 3-month 3000
  - a one-off spike month is clamped to `median × 2`
  - weights 1..n (newest heaviest)
  - the current incomplete month is excluded
  - `historyMonths` is reported
  - results are integers

### Implementation for User Story 3

- [X] T039 [P] [US3] Implement `backend/src/lib/aggregate.ts`: `aggregate(transactions)`
  returns `Map<yyyy-mm, MonthlyAggregate>` matching data-model.md "Monthly Aggregate".
- [X] T040 [P] [US3] Implement `backend/src/lib/forecast.ts`:
  `forecast(aggregates, today)` → `{ status, historyMonths, overall: {nextMonthMinor,
  next3MonthsMinor}, byCategory }`.
  - Use up to 6 complete months, minimum 2.
  - Clamp each month to `median × 2`.
  - Apply a linearly weighted moving average and round to an integer.
  - 3-month = 3 × next (research R10).
- [X] T041 [US3] Extend `backend/src/stream-router.ts`. For any `TXN#` record, emit one
  `RecomputeUser` message per distinct user in the batch to `FORECAST_QUEUE_URL`.
  `changedAt` is the newest `ApproximateCreationDateTime`, and `correlationId` is the newest
  `lastCorrelationId`. Ignore `AGG#`/`FORECAST` (no loop). Add cases to
  `backend/tests/unit/stream-router.test.ts`: 5 `TXN#` records for 2 users → 2 messages.
- [X] T042 [US3] Implement `backend/src/forecast-worker.ts`:
  - **SQS mode**: de-duplicate userIds in the batch (keep max `changedAt`). Skip if
    `FORECAST.sourceChangedAt >= changedAt`. Otherwise `queryAll(TXN#)`, then `aggregate`,
    then `batchWriteAll` all `AGG#` items (deleting stale `AGG#` months with no transactions),
    then put `FORECAST` with `computedAt` and `sourceChangedAt`. Return
    `batchItemFailures` per user.
  - **Scheduler mode** (`event.mode === "daily"`): query the `ACTIVE#` partitions for the
    current and previous 2 months, de-duplicate, and `SendMessageBatch` one `RecomputeUser`
    per user (`changedAt` = now) to `forecast-queue` (contracts/queues.md).
- [X] T043 [US3] Add `GET /api/insights` in `backend/src/api.ts`:
  - Return the last 12 `AGG#` months and `FORECAST`.
  - If no `FORECAST` exists yet → `forecast.status: "pending"`.
  - `processing: true` when the newest `TXN#` `updatedAt` is later than
    `FORECAST.computedAt` (track via `PROFILE.lastTxnChangeAt`, written on every transaction
    write in the T019 and T032 paths).
- [X] T044 [US3] Add to `infra/stack.ts`:
  - SQS `forecast-queue` (visibility 12 min) with `forecast-dlq` (maxReceiveCount 3, 14
    days).
  - `NodejsFunction` `forecast-worker` (2 min timeout). SQS event source: batch 100,
    `maxBatchingWindow` 60 s, `maxConcurrency: 2`, `reportBatchItemFailures`.
  - An EventBridge Scheduler `CfnSchedule`, `cron(0 2 * * ? *)` UTC, targeting the
    `forecast-worker` Lambda with input `{"mode":"daily"}` and a role that has
    `lambda:InvokeFunction` on it only. Use no custom event bus.
  - Grants: router `sqs:SendMessage` on forecast-queue; worker table read/write plus
    `sqs:SendMessage` on forecast-queue.
- [X] T045 [US3] Implement `frontend/src/pages/Insights.tsx`:
  - Monthly table/bar view of expense and savings per category for the last 12 months
    (plain CSS bars, no chart library).
  - Forecast card: "Estimated next month: X", "next 3 months: Y", labeled "Estimate based on
    N months of history", with a per-category breakdown.
  - `insufficient_history` → "Forecasts need at least 2 full months of data" (V9).
  - `processing`/`pending` → an "Updating…" badge with `computedAt` (US3 scenario 3).

**Checkpoint**: quickstart V9–V10 pass. US1 and US2 still work.

---

## Phase 6: User Story 4 - Operator monitors system health and cost (Priority: P4)

**Goal**: Central traceable logs, failure alarms, cost and free-tier alerts.

**Independent Test**: quickstart V11.

- [X] T046 [US4] Verify and complete correlation propagation:
  - The api stores `lastCorrelationId` on every written `TXN#`, `JOB#` and `ACCT#` item.
  - `stream-router` copies it into message bodies.
  - Both workers log with it (`backend/src/api.ts`, `backend/src/stream-router.ts`,
    `backend/src/ingest-worker.ts`, `backend/src/forecast-worker.ts`).
  - Add a check to `backend/tests/unit/stream-router.test.ts` that the output messages carry
    the input `lastCorrelationId`.
- [X] T047 [US4] Add alarms to `infra/stack.ts`, 8 alarm metrics total (research R13), all
  with SNS `alerts` as the action:
  - One `MathExpression` alarm `SUM` of `Errors` across api, stream-router, ingest-worker and
    forecast-worker (> 5 in 5 min).
  - One `MathExpression` alarm on `ApproximateNumberOfMessagesVisible` across `ingest-dlq`,
    `forecast-dlq` and `stream-dlq` (> 0).
  - One alarm on DynamoDB `ThrottledRequests` (> 0 in 5 min).
- [X] T048 [US4] Add an AWS Budgets `CfnBudget` (COST, monthly, $0.10 limit) to
  `infra/stack.ts`, with notifications at ACTUAL > $0.05 and FORECASTED > $0.10 to
  `alertEmail` (constitution I).
- [X] T049 [P] [US4] Document the operator runbook in `README.md`:
  - Enabling the single AWS Free Tier usage alert (Billing → Billing preferences → "Receive
    AWS Free Tier alerts", 85%, FR-031).
  - The Logs Insights correlation query and the DLQ replay command
    `aws sqs start-message-move-task`, from quickstart.md.

**Checkpoint**: quickstart V11 passes (deploy with context `allowPoison=true` for the dev
stack).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T050 Implement `DELETE /api/me` in `backend/src/api.ts` (FR-007):
  - If the user has ≤ 5,000 items, delete them all plus their `ACTIVE#` markers inline via
    `batchWriteAll`, then `AdminDeleteUser`, and return 204.
  - Otherwise send `{kind:"deleteUser"}` to `ingest-queue` and call `AdminDeleteUser`
    immediately, returning 202.
  - Grant the api `cognito-idp:AdminDeleteUser` on the pool in `infra/stack.ts`.
  - Add a delete-account button with confirmation in `frontend/src/pages/Settings.tsx`.
- [X] T051 [P] Write `scripts/smoke.sh`, covering quickstart V2–V8 and V12 via `curl` + `jq`
  against `SiteUrl`. It creates two test users with `aws cognito-idp admin-create-user` /
  `admin-set-user-password` and gets tokens with `aws cognito-idp initiate-auth` using
  `ADMIN_USER_PASSWORD_AUTH`. Enable that flow only when the `smoke` context flag is set in
  `infra/stack.ts`.
- [X] T052 [P] Write `README.md` sections: prerequisites, deploy (`npm ci && npm test &&
  npx cdk deploy -c alertEmail=…`), teardown, cost ledger (S3 only, ≈ $0.001/month), and the
  architecture diagram from contracts/queues.md.
- [ ] T053 Run `npm test` (all unit tests green) and `npx cdk synth`. Confirm the synthesized
  template contains:
  - no `AWS::Events::EventBus`, `AWS::Events::Rule` or `AWS::ApiGateway*` resources
  - a table `BillingMode` of PROVISIONED
  - no `AWS::ApplicationAutoScaling*` resources
  - ≤ 10 alarm metrics
  Then deploy and run quickstart V1–V12, recording results in
  `specs/001-serverless-finance-tracker/quickstart.md`.

---

## Implementation Notes (deviations from task text)

- T003: frontend scaffolded by hand (same result as the Vite template, no demo content to delete).
- T032: duplicates are detected by querying existing `TXN#` keys in the import's date range, then
  `BatchWriteItem` for new rows only (faster at 25 WCU than per-item conditional puts; same
  idempotency because the key contains the fingerprint).
- T033/T050: unlinking with `deleteTransactions=true` and `DELETE /api/me` are always async via
  `ingest-queue` (`deleteAccountData` / `deleteUser`). Bulk deletes at 25 WCU exceed the API
  timeout. `DELETE /api/me` always returns 202.
- T042: no skip-if-fresh check (stream timestamps are 1-second precision); always recompute,
  skipping deleted users.
- T047: throttle alarm uses `ReadThrottleEvents + WriteThrottleEvents` (2 metrics); 9 alarm
  metrics total, still within the free 10.
- T012/T034: SPA routing uses a CloudFront Function, not error responses (those would rewrite API
  404s). The uploads bucket CORS allows origin `*` to avoid a CloudFront↔bucket dependency cycle;
  the presigned POST policy is the authorization.
- T053: automated part done (tests, typecheck, synth constraints). Deploy and quickstart V1–V12
  are still pending.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup; blocks all stories.
- **US1 (Phase 3)**: depends on Foundational only.
- **US2 (Phase 4)**: depends on Foundational. It uses `lib/transactions.ts` from US1 (T018),
  so do T018 first if running in parallel.
- **US3 (Phase 5)**: depends on Foundational. T041 extends `stream-router.ts` from US2 (T031),
  and T044 extends the stack after T034. Data for meaningful testing comes from US1/US2.
- **US4 (Phase 6)**: depends on all functions existing (after US3).
- **Polish (Phase 7)**: after the desired stories.

### Within Each Story

Tests → lib modules → handlers/routes → infra wiring → frontend page.
`infra/stack.ts` and `backend/src/api.ts` are shared files, so tasks editing them are never
[P].

### Parallel Opportunities

- Setup: T002, T003, T004 together.
- Foundational: T006, T007 alongside T005; T014 alongside T013.
- US1: T016, T017, T020 together.
- US2: T023–T030 and T036 together (separate test and lib files).
- US3: T037–T040 together.

---

## Parallel Example: User Story 2

```bash
# All tests and pure lib modules at once:
Task: "Unit tests dedupe in backend/tests/unit/dedupe.test.ts"           # T023
Task: "Unit tests csv in backend/tests/unit/csv.test.ts"                 # T024
Task: "Unit tests categorize/simulator in backend/tests/unit/"           # T025
Task: "Unit tests stream-router in backend/tests/unit/stream-router.test.ts" # T026
Task: "Implement backend/src/lib/dedupe.ts"                              # T027
Task: "Implement backend/src/lib/csv.ts"                                 # T028
Task: "Implement backend/src/lib/categorize.ts"                          # T029
Task: "Implement backend/src/lib/simulator.ts"                           # T030
# Then sequentially: T031 → T032 → T033 → T034 → T035
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1.
2. Stop and validate with quickstart V1–V4. The workshop can already demo sign-up and manual
   tracking.

### Incremental Delivery

1. + US2: simulated accounts and CSV import (V5–V8).
2. + US3: insights and forecasts (V9–V10).
3. + US4: alarms and runbook (V11).
4. Polish: account deletion, smoke script, final verification (V12, T053).

Each increment deploys with `npx cdk deploy` and keeps earlier stories working.
