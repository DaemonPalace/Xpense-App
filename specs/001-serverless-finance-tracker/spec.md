# Feature Specification: Serverless Personal Finance Tracker

**Feature Branch**: `001-serverless-finance-tracker`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Build a serverless, event-driven personal finance tracking application designed strictly around AWS Free Tier limits. Core: Cognito auth; connect/mock financial accounts to ingest transaction history (expenses and savings); publish sync/input events to EventBridge; route heavy processing (parsing, forecasting) through SQS to Lambda workers; store profiles, raw account items, transactions and historical aggregations in DynamoDB; a dedicated worker generates basic future expense predictions; SPA on S3 + CloudFront; centralized logging and error tracking in CloudWatch. Constraint: stay strictly within AWS Free Tier thresholds (1M Lambda requests/month, 25GB DynamoDB storage, 1GB S3 storage, 50k Cognito MAUs)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up and manually track transactions (Priority: P1)

A new user creates an account, signs in, and records expenses and savings deposits by hand. They see a list of their transactions and a running summary of spending and savings for the current month.

**Why this priority**: Account security and the ability to record and see money movements are the core value. Without this, nothing else matters; with only this, the product is already a usable personal ledger.

**Independent Test**: Register a new account, verify email, sign in, add five transactions (mix of expenses and savings), and confirm they appear in the list and the monthly totals are correct. Sign out and confirm the data is no longer accessible without signing in again.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they sign up with an email and a password meeting the password policy and confirm the verification code sent to their email, **Then** their account is active and they can sign in.
2. **Given** a signed-in user, **When** they add an expense with amount, date, category and description, **Then** it appears in their transaction list and the monthly expense total increases by that amount.
3. **Given** a signed-in user, **When** they add a savings deposit, **Then** it appears in the list and the monthly savings total increases by that amount.
4. **Given** a signed-in user, **When** they edit or delete one of their transactions, **Then** the list and totals reflect the change.
5. **Given** a user whose session has been idle past its expiry, **When** they take any action, **Then** the session is silently renewed if still valid, otherwise they are asked to sign in again with no data loss of the unsaved form.
6. **Given** two different users, **When** either views their transactions, **Then** they see only their own data.

---

### User Story 2 - Connect a (simulated) financial account and sync history (Priority: P2)

A signed-in user links a financial account (checking, credit card or savings) through a simulated bank connection, or uploads a transaction export file. The system imports the account's transaction history in the background, de-duplicates it, categorizes it, and the user is notified when the import finishes.

**Why this priority**: Automatic ingestion removes the tedium of manual entry and provides the historical volume that predictions need, but the product is still useful without it.

**Independent Test**: Link a simulated account containing 6 months of generated transactions; confirm the request returns immediately, the account shows a "syncing" status, and within the target time the status becomes "synced" and all transactions are visible and categorized. Re-run the sync and confirm no duplicates appear.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they link a simulated account, **Then** the account appears in their account list with status "syncing" and the screen remains responsive.
2. **Given** a sync in progress, **When** processing completes, **Then** the account status changes to "synced", the last-synced time is shown, and imported transactions appear in the list.
3. **Given** an account already synced, **When** the user triggers another sync, **Then** only new transactions are added and no duplicates are created.
4. **Given** a user uploads a transaction export file in the supported format, **When** parsing completes, **Then** valid rows become transactions and the user sees a count of imported, skipped (duplicate) and rejected (invalid) rows.
5. **Given** a sync or import fails, **When** the user views the account, **Then** status shows "failed" with a plain-language reason and a retry option.
6. **Given** a linked account, **When** the user unlinks it, **Then** future syncs stop and the user chooses whether to keep or delete its imported transactions.

---

### User Story 3 - View spending history and expense predictions (Priority: P3)

A user with at least some history opens an insights view showing monthly spending and savings trends by category, plus a forecast of expected spending for the next month and next three months, overall and per category.

**Why this priority**: Predictions are the differentiating feature but depend on data from Stories 1 and 2.

**Independent Test**: Seed a user with 6 months of transactions; confirm the insights view shows historical monthly aggregates matching the raw data, and a forecast for the next 1 and 3 months with a stated basis (e.g., "based on 6 months of history"). Add a new transaction and confirm aggregates and forecast refresh.

**Acceptance Scenarios**:

1. **Given** a user with at least 2 full months of history, **When** they open insights, **Then** they see monthly totals per category and a next-month and next-3-months forecast, overall and per category.
2. **Given** a user with less than 2 full months of history, **When** they open insights, **Then** they see their history and a message explaining that forecasts need more data, instead of an unreliable number.
3. **Given** new transactions are added, imported or changed, **When** recalculation completes, **Then** aggregates and forecasts reflect the change and show when they were last updated.
4. **Given** a forecast is displayed, **When** the user views it, **Then** it is labeled as an estimate with the amount of history used.

---

### User Story 4 - Operator monitors system health and cost (Priority: P4)

The operator (application owner) can see, in one place, logs and errors from every part of the system, trace a single user action through all processing steps, receive an alert when errors spike or a processing step repeatedly fails, and receive an alert before usage approaches free-tier limits.

**Why this priority**: Required for reliable operation and to enforce the zero-cost constraint, but invisible to end users.

**Independent Test**: Trigger a deliberately failing import; confirm the failure is visible in the central log location with a correlation identifier linking request, event and worker entries, that the failed job is retained for inspection/replay, and that an alert fires.

**Acceptance Scenarios**:

1. **Given** any user action that triggers background processing, **When** the operator searches by its correlation identifier, **Then** all log entries for that action across all components are returned.
2. **Given** a background job fails after all retries, **When** the operator checks, **Then** the job is preserved for inspection and can be replayed, and an alert was sent.
3. **Given** monthly usage reaches 85% of any free-tier threshold, **When** the threshold is crossed, **Then** the operator is alerted.

---

### Edge Cases

- User signs up with an email already registered: generic message, no account enumeration.
- Repeated failed sign-in attempts: account temporarily locked / throttled.
- Duplicate events delivered or a sync triggered twice concurrently: processing is idempotent; no duplicate transactions or double-counted totals.
- Imported file is malformed, empty, too large (over 5 MB or 10,000 rows), or uses an unsupported format: rejected with a clear message; nothing partially imported without a summary.
- Transactions in the future, zero amount, or extremely large amounts: rejected or flagged per validation rules.
- Refunds/negative expenses: reduce the category total for that month.
- Forecast for a category with highly irregular spending (single large one-off): forecast still produced, but one-off outliers do not dominate the estimate.
- Background processing is backlogged: user sees "processing" status rather than stale data presented as current.
- Usage approaching free-tier limits: non-essential background work (e.g., forecast recalculation) is deferred/batched before user-facing actions are degraded.
- User deletes their account: all their data (profile, accounts, transactions, aggregates, forecasts) is removed.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication & accounts**

- **FR-001**: System MUST allow users to sign up with email and password, verifying the email via a one-time code before the account is active.
- **FR-002**: System MUST enforce a password policy (minimum 8 characters, including upper, lower, number and symbol).
- **FR-003**: System MUST allow sign-in, sign-out, and password reset via email.
- **FR-004**: System MUST issue short-lived access credentials (max 1 hour) with automatic renewal while the user remains signed in (renewal valid up to 30 days).
- **FR-005**: System MUST ensure every data read and write is restricted to the authenticated user's own records.
- **FR-006**: System MUST throttle repeated failed sign-in attempts.
- **FR-007**: Users MUST be able to delete their account and all associated data.

**Transactions**

- **FR-008**: Users MUST be able to create, view, edit and delete transactions with: amount, date, type (expense or savings), category, description, and source account (optional for manual entries).
- **FR-009**: System MUST provide a default category set (e.g., Housing, Food, Transport, Utilities, Entertainment, Health, Shopping, Income/Savings, Other) and allow users to recategorize transactions.
- **FR-010**: Users MUST be able to filter transactions by date range, category, type and account.
- **FR-011**: System MUST store monetary amounts exactly (no floating-point rounding errors) in a single currency per user.

**Financial account integration**

- **FR-012**: Users MUST be able to link one or more simulated financial accounts (checking, credit card, savings) that generate realistic transaction history.
- **FR-013**: Users MUST be able to import transactions from a CSV export file (date, description, amount, optional category).
- **FR-014**: System MUST process account syncs and file imports asynchronously, returning control to the user immediately and showing per-account status (syncing, synced, failed) and last-synced time.
- **FR-015**: System MUST de-duplicate imported transactions so repeated syncs or re-uploads never create duplicates.
- **FR-016**: System MUST auto-categorize imported transactions using description keywords, falling back to "Other".
- **FR-017**: System MUST retain the raw imported record alongside the normalized transaction for audit and reprocessing.
- **FR-018**: Users MUST be able to unlink an account and choose to keep or delete its transactions.
- **FR-019**: System MUST NOT store real banking credentials; simulated connections use no credentials.

**Event-driven processing**

- **FR-020**: Every user data change (manual entry, edit, delete, sync, import) MUST emit a domain event that downstream processing reacts to, decoupled from the user request.
- **FR-021**: Heavy work (file parsing, sync ingestion, aggregation, forecasting) MUST run in background workers fed by durable queues, with automatic retries (up to 3 attempts) and failed jobs retained for inspection and replay.
- **FR-022**: All background processing MUST be idempotent: re-delivery of the same event produces the same result.

**Aggregation & prediction**

- **FR-023**: System MUST maintain monthly aggregates per user, per category and per type, kept consistent with the underlying transactions.
- **FR-024**: System MUST generate forecasts of expected expenses for the next month and next 3 months, overall and per category, when at least 2 full months of history exist.
- **FR-025**: Forecasts MUST use a basic, explainable method (e.g., weighted moving average over up to the last 6 months, with outlier dampening), and display the history window used.
- **FR-026**: Forecasts MUST be recalculated after relevant data changes, batched so multiple changes within a short window trigger a single recalculation, and refreshed at least once daily.

**Frontend**

- **FR-027**: System MUST provide a browser-based single-page application covering sign-up/sign-in, transactions, accounts, and insights, usable on desktop and mobile screen widths.
- **FR-028**: The application MUST be served only over encrypted connections.

**Observability & cost control**

- **FR-029**: All components MUST write structured logs to one central location, each entry carrying a correlation identifier that follows a user action through every processing step.
- **FR-030**: System MUST record errors with enough context to diagnose them (component, correlation id, error type) without logging sensitive data (passwords, tokens, full account numbers).
- **FR-031**: System MUST alert the operator on error-rate spikes, failed jobs after retries, and usage reaching 85% of any free-tier threshold (one account-wide free-tier usage alert is sufficient).
- **FR-032**: Log retention MUST be bounded (default 14 days) to stay within free storage allowances.
- **FR-033**: Every resource MUST be a service that offers an AWS Free Tier allowance and be configured to stay within the thresholds listed in Constraints; no component may require paid-only features. Minimal charges (under $0.05/month total) are acceptable where a requested service bills a small usage dimension outside its allowance.

### Key Entities

- **User Profile**: The account holder. Email, display name, currency, created date, preferences. Owns all other entities.
- **Financial Account**: A linked (simulated) or import-source account. Name, type (checking, credit card, savings), status (syncing/synced/failed/unlinked), last-synced time, failure reason.
- **Raw Account Item**: Unmodified record as received from a sync or file import, linked to its account and import job; kept for audit/reprocessing.
- **Transaction**: Normalized money movement. Amount, date, type (expense/savings), category, description, source account, origin (manual/sync/import), de-duplication fingerprint.
- **Import Job**: One sync or file import run. Status, counts (imported/skipped/rejected), started/finished time, error details.
- **Monthly Aggregate**: Per user, month, category and type: total amount and transaction count.
- **Forecast**: Per user and category (plus overall): predicted amount for next month and next 3 months, history window used, generated time.
- **Category**: Default or user-assigned label used for grouping and keyword-based auto-categorization.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can sign up, verify their email and record their first transaction in under 3 minutes.
- **SC-002**: Manually entered transactions appear in the user's list within 1 second and monthly totals update within 10 seconds.
- **SC-003**: A sync or import of up to 1,000 transactions completes and is visible to the user within 60 seconds for 95% of runs.
- **SC-004**: Zero duplicate transactions after repeating the same sync or import any number of times.
- **SC-005**: Forecasts are refreshed within 5 minutes of the last data change and at least once every 24 hours.
- **SC-006**: For users with 6 months of stable history, next-month total forecast is within 20% of actual spending for at least 70% of users.
- **SC-007**: The operator can locate all log entries for any single user action using one identifier in under 2 minutes.
- **SC-008**: Monthly cloud bill stays under $0.05 at a load of up to 100 monthly active users, each performing ~100 actions and 1 sync per month, using only services that offer a free-tier allowance.
- **SC-009**: No user can ever view or modify another user's data (verified by cross-account access tests).
- **SC-010**: 90% of test users complete linking an account and viewing their forecast on first attempt without help.

## Assumptions

- **Simulated connections only for v1**: Real bank aggregation services are paid and would break the zero-cost constraint, so "connect account" uses a built-in simulator that generates realistic history, plus CSV upload. A real aggregator can be added later behind the same account/sync flow.
- Single currency per user (default USD); no multi-currency conversion.
- Personal, single-user accounts; no shared/household accounts or roles beyond end user and operator.
- Target scale is a workshop demo: at most 100 users, far inside free-tier limits.
- Email/password is the only sign-in method; social sign-in and multi-factor auth are out of scope for v1 (MFA can be enabled later).
- Forecasting is statistical (moving-average style), not machine-learning based.
- Supported import format is CSV with a documented column layout; other formats (OFX/QIF/PDF) are out of scope.
- Free-tier thresholds are evaluated on the always-free and 12-month allowances available to the operator's account; the operator sets up a billing alarm as a backstop.
- Data retention: user data kept until the user deletes it; logs kept 14 days; failed jobs kept 14 days.

## Constraints & Dependencies

These platform choices were set by the requester and are binding for planning:

- **Platform**: AWS, serverless and event-driven.
  - Identity: Amazon Cognito.
  - Change capture: DynamoDB Streams; queues: Amazon SQS; compute: AWS Lambda workers.
  - Scheduling: Amazon EventBridge Scheduler (free allowance). EventBridge custom events are
    not used: they have no free allowance (requester decision, replaces the original
    "publish events to EventBridge" requirement).
  - Storage: Amazon DynamoDB (on-demand or free-tier provisioned capacity).
  - Frontend hosting: Amazon S3 + Amazon CloudFront.
  - Observability: Amazon CloudWatch.
- **Free Tier ceilings** (must not be exceeded): 1M Lambda requests/month, 25 GB DynamoDB storage, 1 GB S3 storage, 10k Cognito MAUs (current free tier; originally stated as 50k), plus the free allowances of every other service used.
- **Cost tolerance**: Minimal charges (under $0.05/month) are acceptable; only services with a free-tier allowance may be used.
- **Scale**: Workshop demo, at most 100 users.
