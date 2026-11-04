# Data Model: Serverless Personal Finance Tracker

Single DynamoDB table `FinanceTable`, provisioned 25 RCU / 25 WCU, Streams `NEW_AND_OLD_IMAGES`,
no GSIs. Every user-data item is partitioned by user, so every API query is scoped to `PK = USER#<sub>`
where `<sub>` comes from the verified token (constitution III). The only exception is the
`ACTIVE#` marker, read solely by the daily scheduled job (never by the API).

| Entity | PK | SK |
|---|---|---|
| User Profile | `USER#<sub>` | `PROFILE` |
| Financial Account | `USER#<sub>` | `ACCT#<accountId>` |
| Import Job | `USER#<sub>` | `JOB#<jobId>` |
| Raw Account Item chunk | `USER#<sub>` | `RAW#<jobId>#<chunkNo>` |
| Transaction | `USER#<sub>` | `TXN#<yyyy-mm-dd>#<txnId>` |
| Monthly Aggregate | `USER#<sub>` | `AGG#<yyyy-mm>` |
| Forecast | `USER#<sub>` | `FORECAST` |
| Activity marker | `ACTIVE#<yyyy-mm>` | `USER#<sub>` |

IDs: `accountId`, `jobId` = ULID. `txnId` = ULID (manual) or fingerprint hex (sync/import).
Money: all amounts are **integer minor units** (`amountMinor`, e.g. cents) — never floats (FR-011).

## User Profile
| Field | Type | Rules |
|---|---|---|
| email | string | from Cognito, read-only |
| displayName | string | 1–60 chars |
| currency | string | ISO 4217, default `USD`, immutable after first transaction |
| createdAt | ISO datetime | |
| lastActiveAt | ISO datetime | updated at most once/day; drives daily forecast fan-out |

## Financial Account
| Field | Type | Rules |
|---|---|---|
| accountId | ULID | |
| name | string | 1–60 chars |
| type | enum | `checking` \| `credit_card` \| `savings` |
| source | enum | `simulated` \| `csv` |
| status | enum | see state machine |
| lastSyncedAt | ISO datetime \| null | |
| failureReason | string \| null | plain language, set when `failed` |

State machine:
```
linked ──sync requested──▶ syncing ──worker ok──▶ synced ──sync requested──▶ syncing
                              │                                              
                              └─worker fails after 3 tries──▶ failed ──retry──▶ syncing
any ──unlink──▶ (item deleted; transactions kept or deleted per user choice)
```
Sync request on an account already `syncing` → 409 (prevents concurrent syncs; conditional update).

## Import Job
| Field | Type | Rules |
|---|---|---|
| jobId | ULID | |
| accountId | ULID | |
| kind | enum | `sync` \| `csv` |
| status | enum | (`awaiting_upload` →) `queued` → `running` → `succeeded` \| `failed`. CSV jobs start `awaiting_upload`; the transition to `queued` is what `stream-router` routes to `ingest-queue` |
| imported / skipped / rejected | int | counts (FR-013 summary) |
| rejections | list<{row:int, reason:string}> | first 50 only |
| uploadKey | string \| null | S3 key for csv |
| correlationId | string | |
| startedAt / finishedAt | ISO datetime | |

## Raw Account Item (chunk)
| Field | Type | Rules |
|---|---|---|
| jobId, chunkNo | | |
| rows | list<map> | unmodified source rows, ≤ ~300 KB per item |

Kept for audit/reprocessing (FR-017); deleted with the account if user chooses delete.

## Transaction
| Field | Type | Rules |
|---|---|---|
| txnId | string | |
| date | yyyy-mm-dd | not in the future (> today + 1 day in user tz rejected) |
| amountMinor | int | ≠ 0; abs ≤ 100,000,000 (1M units); negative = refund/withdrawal |
| type | enum | `expense` \| `savings` |
| category | enum | default set (below) |
| description | string | 1–200 chars |
| accountId | ULID \| null | null for manual |
| origin | enum | `manual` \| `sync` \| `csv` |
| fingerprint | hex \| null | sync/csv only; equals txnId |
| jobId | ULID \| null | |
| createdAt / updatedAt | ISO datetime | |

Editing `date` = delete old item + put new item in one `TransactWriteItems`.
Duplicate rejection: `PutItem` with `attribute_not_exists(SK)` (research R9).

Default categories: `housing, food, transport, utilities, entertainment, health, shopping,
savings, other`. Auto-categorization: keyword map per category on lowercased description,
first match wins, else `other` (FR-016).

## Monthly Aggregate
| Field | Type | Rules |
|---|---|---|
| month | yyyy-mm | |
| totals | map<category, {expenseMinor:int, savingsMinor:int, count:int}> | |
| expenseMinor / savingsMinor | int | month totals |
| computedAt | ISO datetime | |

Derived only by the forecast worker via full recompute of the user's transactions (idempotent).

## Forecast
| Field | Type | Rules |
|---|---|---|
| status | enum | `ok` \| `insufficient_history` |
| historyMonths | int | 0–6 months used |
| overall | {nextMonthMinor:int, next3MonthsMinor:int} | |
| byCategory | map<category, {nextMonthMinor, next3MonthsMinor}> | |
| computedAt | ISO datetime | |
| sourceChangedAt | ISO datetime | latest event time included (skip-if-stale check) |

`insufficient_history` when fewer than 2 complete months of transactions (FR-024).

## Activity marker
Written (put, idempotent) together with `lastActiveAt` at most once per day. The daily forecast
job queries the current and previous 2 `ACTIVE#<yyyy-mm>` partitions instead of scanning the
table (a scan would burn the 25 RCU budget). Markers older than 3 months expire via TTL
(`expiresAt`).

## Account deletion (FR-007)
API enqueues `deleteUser` on `ingest-queue`, then deletes the Cognito user (202). The worker
deletes `PROFILE` first (stops forecast recomputes), then all `PK = USER#<sub>` items and the
user's `ACTIVE#` markers via `BatchWriteItem`. Always async: at 25 WCU even 1k items exceed the
API timeout.
