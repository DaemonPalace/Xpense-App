# Implementation Plan: Serverless Personal Finance Tracker

**Branch**: `001-serverless-finance-tracker` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-serverless-finance-tracker/spec.md`

## Summary

A personal finance tracker where users sign up (Cognito), record expenses and savings, link a
simulated bank account or upload a CSV, and see monthly trends plus 1- and 3-month expense
forecasts. A single-page app on S3 + CloudFront calls one API Lambda through a Function URL
behind CloudFront. The API writes only to a single provisioned DynamoDB table; sync and import
requests are job records. The table's stream feeds a `stream-router` Lambda that sends job and
recompute messages to two SQS queues. The queues feed two workers: ingest (simulator/CSV
parsing, de-dup, categorization) and forecast (aggregates + weighted moving average).
EventBridge is used only for the free Scheduler (daily forecast refresh); no custom events.
Sized for a 100-user workshop demo. Every resource has a free-tier allowance; the only billed
usage is S3 storage/requests, about $0.001/month (constitution v2.1.0 allows < $0.05).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22.x (Lambda `nodejs22.x`, arm64); browser
ES2022

**Primary Dependencies**:
- Infrastructure: AWS CDK v2.
- Lambda: AWS SDK v3, `aws-jwt-verify`, `ulid`.
- Frontend: React 18 + Vite, `amazon-cognito-identity-js`.
- No CSV library: an RFC 4180 parser of about 40 lines, with tests.

**Storage**: DynamoDB single table, provisioned 25 RCU / 25 WCU, Streams on. S3: `site` bucket
(SPA) and `uploads` bucket (1-day lifecycle).

**Testing**: Vitest for unit tests (domain logic, money, authorization). Integration and smoke
tests run against a deployed dev stack (`scripts/smoke.sh`, see quickstart).

**Target Platform**: AWS, single region (default `us-east-1`); evergreen desktop and mobile
browsers.

**Project Type**: Web application (SPA + serverless backend + IaC).

**Performance Goals**:
- UI writes visible in < 1 s.
- Totals update in < 10 s.
- 1,000-row sync done in < 60 s (p95).
- Forecast refreshed in < 5 min.

**Constraints**:
- Free-tier-eligible services only; monthly bill < $0.05 (expected < $0.01).
- ≤ 25 WCU/RCU.
- ≤ 10 alarm metrics.
- 14-day log retention.
- No API Gateway, NAT, or VPC.
- Amounts stored as integer cents.

**Scale/Scope**:
- At most 100 users (workshop demo); 10k MAU is the Cognito free ceiling.
- About 5k transactions per user maximum.
- 4 SPA views (auth, transactions, accounts, insights) plus settings.
- 4 Lambda functions.

All unknowns resolved in [research.md](research.md). No NEEDS CLARIFICATION remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|---|---|---|---|
| I. Free-Tier-Eligible, Minimal Cost | Only services with a free-tier allowance; every charge estimated; bill < $0.05; billing + usage alarms | ✅ | ✅ Every service has a free-tier allowance and EventBridge custom events are not used (R2); only billed dimension is S3 ≈ $0.001, listed below. Budget table in research R1: all services < 2% of their allowance. $0.05 budget + 85% Free Tier usage alert (R13) |
| II. Serverless & Event-Driven | No servers; async heavy work; idempotent consumers; DLQs | ✅ | ✅ Stream outbox → stream-router → SQS (+DLQ) → workers; conditional writes and skip-if-fresh make every consumer idempotent (R4, R5, R9) |
| III. Security & Isolation | Server-side identity; least privilege; no secrets in logs; encryption | ✅ | ✅ JWT verified in the API; all keys `USER#<sub>` from the token; origin-secret header blocks direct Function URL calls; one IAM role per function scoped to the actions it uses; HTTPS-only CloudFront; S3 and DynamoDB default encryption |
| IV. Observable by Default | JSON logs + correlationId; 14-day retention; alarms | ✅ | ✅ correlationId flows header → item `lastCorrelationId` → stream-router → SQS message → worker logs (R13) |
| V. Simplicity & Verified Behavior | Minimal moving parts; IaC one command; tests for money/security | ✅ | ✅ 1 table, 4 functions, 2 queues, 1 bus, 1 stack, `cdk deploy`. Unit tests for money, de-dup, CSV, categorization, forecast, authorization; cross-user test V3 |

**Resolved**: Cognito free tier corrected to 10k MAU; cost rule relaxed to < $0.05 and scale set
to 100 users; EventBridge custom events dropped, Scheduler kept (spec + constitution v2.1.0, per
requester).

Free-tier usage alerting: one AWS Free Tier usage alert at 85% (FR-031 amended, per requester).

**Gate result**: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-serverless-finance-tracker/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── openapi.yaml     # HTTP API
│   └── queues.md        # stream routing, SQS messages, worker contracts
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json               # npm workspaces: backend, frontend; root scripts: test, deploy
infra/
├── app.ts                 # CDK app entry
└── stack.ts               # single stack: Cognito, DynamoDB, S3, CloudFront, Lambdas,
                           #   Function URL, EventBridge Scheduler, SQS+DLQs,
                           #   alarms, SNS, budget
backend/
├── src/
│   ├── api.ts             # Function URL handler: auth, router, all /api routes
│   ├── stream-router.ts   # DynamoDB stream → ingest-queue / forecast-queue
│   ├── ingest-worker.ts   # IngestJob: sync / csv / deleteUser
│   ├── forecast-worker.ts # aggregates + forecast; daily fan-out mode
│   └── lib/
│       ├── db.ts          # DynamoDB client + key helpers
│       ├── auth.ts        # JWT verify, origin-secret check
│       ├── log.ts         # JSON log with correlationId
│       ├── money.ts       # parse/format minor units
│       ├── csv.ts         # RFC 4180 parser + row validation
│       ├── categorize.ts  # keyword map
│       ├── dedupe.ts      # fingerprints
│       ├── simulator.ts   # seeded transaction generator
│       └── forecast.ts    # WMA + outlier clamp
└── tests/
    ├── unit/              # *.test.ts per lib module + api authz
    └── fixtures/          # sample.csv, poison.csv
frontend/
├── index.html
└── src/
    ├── main.tsx           # router
    ├── auth.ts            # Cognito SRP, token refresh
    ├── api.ts             # fetch wrapper, correlation id, 401 handling
    └── pages/             # SignIn, SignUp, Transactions, Accounts, Insights, Settings
scripts/
└── smoke.sh               # quickstart V1–V12 API checks
```

**Structure Decision**: A web application with three top-level code units (`infra`,
`backend`, `frontend`) and one CDK stack. All backend functions live in one package so they
share `lib/`. Each handler file is one Lambda entry that esbuild bundles separately.

## Cost Ledger

Billed usage allowed by constitution v2.1.0 Principle I (all from free-tier services):

| Charge | Estimate at 100 users | Why |
|---|---|---|
| S3 storage + requests (no Always Free tier on new accounts) | ≈ $0.001/month | SPA hosting (mandated) and CSV uploads (R7) |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Lambda Function URL + in-code JWT check instead of API Gateway authorizer | API Gateway's free allowance is 12-month-only, not offered to new accounts; using it would add a billed service without a usable allowance | API Gateway HTTP API costs ~$1/M requests (R3) |
