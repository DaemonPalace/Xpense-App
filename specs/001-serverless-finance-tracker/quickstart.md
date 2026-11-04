# Quickstart & Validation Guide

Proves the feature end to end. Contracts: [openapi.yaml](contracts/openapi.yaml),
[queues.md](contracts/queues.md). Data shapes: [data-model.md](data-model.md).

## Prerequisites

- AWS account with Always Free allowances (see [research.md](research.md) R1), CLI configured
  (`aws sts get-caller-identity` works). Region with all services, e.g. `us-east-1`.
- Node.js 22+, npm.
- One-time: `npx cdk bootstrap` (creates a small staging bucket; S3 storage cost ≈ $0.00).
- Billing console: enable **Free Tier usage alerts** and confirm alert email.

## Setup & deploy

```bash
npm ci
npm test                          # unit tests (money, dedupe, csv, categorize, forecast, authz)
npx cdk deploy -c alertEmail=you@example.com   # one command: infra + backend + SPA upload
```
Outputs: `SiteUrl` (CloudFront), `UserPoolId`, `UserPoolClientId`. Confirm the SNS subscription email.

## Validation scenarios

Run against `SiteUrl` in a browser (UI) or with `scripts/smoke.sh` (API, uses a test user).

| # | Story | Steps | Expected |
|---|---|---|---|
| V1 | US1 | Sign up, enter emailed code, sign in | Lands on transactions page; < 3 min (SC-001) |
| V2 | US1 | Add 3 expenses + 2 savings; edit one; delete one | List updates < 1 s; month totals correct within 10 s (SC-002) |
| V3 | US1 | Sign in as 2nd user; call `GET /api/transactions/{user1Txn}?date=…` with user2 token | 404; user1 data never visible (SC-009) |
| V4 | US1 | Call any `/api/*` without token, with expired token, and the raw Function URL directly | 401 / 401 / 403 |
| V5 | US2 | Link simulated checking account | 202, status `syncing`; `synced` with ~6 months of categorized txns < 60 s (SC-003) |
| V6 | US2 | Press Sync twice quickly; then sync again later | 2nd concurrent request 409; later sync adds 0 duplicates (SC-004) |
| V7 | US2 | Import `backend/tests/fixtures/sample.csv` (incl. 2 dup rows, 1 bad date) | Summary: imported N, skipped 2, rejected 1 with reason |
| V8 | US2 | Import 6 MB file / non-CSV | Rejected with clear message, nothing imported |
| V9 | US3 | New user with < 2 months data → Insights | History shown + "need more data" message |
| V10 | US3 | Seed user via simulated account (6 months) → Insights | Monthly totals match raw sums; forecast with "based on 6 months"; add txn → refreshed < 5 min (SC-005) |
| V11 | US4 | Import `backend/tests/fixtures/poison.csv` (forces worker error) | Job `failed` w/ reason; message in `ingest-dlq`; alarm email; CloudWatch Logs Insights query by `correlationId` returns API + stream-router + worker entries (SC-007) |
| V12 | — | Delete account from settings | All `USER#<sub>` items gone, Cognito user gone, sign-in fails |

Logs Insights query for V11:
```
fields @timestamp, @log, level, message
| filter correlationId = "<id from x-correlation-id response header>"
| sort @timestamp asc
```

DLQ replay (V11): `aws sqs start-message-move-task --source-arn <ingest-dlq-arn>`.

## Results (2026-10-28, us-east-1, stack `FinanceStack` deployed with `-c smoke=true`)

`npm test`: 10 files, 41 tests passed. V2–V8 and V12 via `scripts/smoke.sh`; V1 manually in the browser.

| # | Result | Notes |
|---|---|---|
| V1 | PASS | Sign-up, emailed code, sign-in via UI |
| V2 | PASS | Create 201, edit 200, zero amount 400 |
| V3 | PASS | User 2 gets 404 on user 1's txn (edit/delete); user 2 list empty |
| V4 | PASS | No token 401; direct Function URL 403 |
| V5 | PASS | Link 202; sync `succeeded`, 202 rows imported |
| V6 | PASS | Concurrent sync 409; re-sync added 0 duplicates |
| V7 | PASS | First import: imported 20, rejected 1 (bad date), skipped 0 (the two identical "Corner Cafe" pairs are legitimate repeats); re-import: imported 0, skipped 20 |
| V8 | PASS | 6 MB upload rejected by the presigned POST size limit |
| V9 | FAIL, fixed | User with no transactions saw "Updating… Calculating your first forecast" forever: no forecast item is written until transactions change, and `GET /api/insights` reported `pending` for a missing item. Now reports `insufficient_history` unless the profile has `lastTxnChangeAt` (`backend/src/api.ts`). Re-run after redeploy. |
| V10 | PENDING | |
| V11 | PENDING | Needs a deploy with `-c allowPoison=true` |
| V12 | FAIL, fixed | `DELETE /api/me` returned 202 and removed the Cognito user, but `ingest-worker` failed on every `deleteUser` message: `queryAll(PK, "")` sent an empty string in `begins_with`, which DynamoDB rejects (`ValidationException ... cannot contain an empty string value. Key: SK`). The error was also swallowed without a log line. Fixed in `backend/src/lib/db.ts` (empty prefix queries the whole partition) and `backend/src/ingest-worker.ts` (log failed records). Re-run after redeploy. |

## Cost check (SC-008)

After validation, Billing → Bills: expect < $0.01 (S3 only, see plan Cost Ledger). Free Tier page: every service < 2% of its allowance.

## Teardown

```bash
npx cdk destroy
```
