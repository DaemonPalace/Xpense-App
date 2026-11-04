# Xpense — MVP Requirements

**Status**: Draft · **Created**: 2026-11-04 · **Platforms**: Android, iOS (Expo / React Native) · **UI language**: Spanish (es-CO)

**Team**: Escalona (UX/UI, QA) · Aponte (backend: API, goals, alerts, vault) · Rodríguez (Belvo integration, categorization) · Gutiérrez (architecture, auth, digital twin) · Prieto (mobile frontend, design system, dashboard, mascot)

**Schedule**: D1 28/10 · D2 04/11 · D3 11/11 (source: `../Cronograma_MVP_Xpense.xlsx`, `../checklist_MVP.xlsx`)

---

## 1. Problem

Universidad de La Sabana students are managing money on their own for the first time. Our survey (n = 20) plus in-person interviews found:

- 40% named financial trouble as the problem with the biggest impact on their daily life.
- 42% said everyday expenses ("gastos") are why they can't save.
- 70% recognized at least one of the financial problems we listed.

**Root cause (5 Whys):** learning to plan expenses is slow and tedious, there is almost no outside support, and the consequences don't show up in the short term. They pile up over time.

**Critical causes (Ishikawa):**
- *People:* impulsive purchases, missing skills and no goals.
- *Platforms:* no rewarding, visible tool that builds the habit.

**Persona (empathy map):** The student buys lunch, snacks, parking, ride-shares and outings every day. Each purchase feels small. They only see the impact once savings are gone. They take money advice from family and friends, rarely from the institution.

**Value proposition:** Xpense shows, before it's too late, how today's spending changes this month's savings goal. It does this with three things:
- a daily "safe to spend" number,
- warnings you can act on,
- a *digital twin wallet* that projects where current habits lead.

## 2. Scope (MoSCoW)

| ID | Feature | Deliverable | Priority |
|---|---|---|---|
| F1 | Account, sign-in, data-processing consent (Ley 1581) | D1 | Must |
| F2 | Onboarding: monthly inflows + savings goal | D1 | Must |
| F3 | Quick manual expense entry (≤ 3 taps) with categories | D1 | Must |
| F4 | Safe-to-spend today / daily limit | D1 | Must |
| F5 | Belvo sandbox connection: read test transactions | D1 | Must |
| F6 | Link account + background sync, de-dup against manual entries | D2 | Must |
| F7 | CSV statement import (fallback when bank unsupported) | D2 | Must |
| F8 | Dashboard: spend by category, weekly cumulative, goal progress | D2 | Must |
| F9 | Auto-categorization + ant-expense ("gasto hormiga") detection | D2 | Must |
| F10 | Spending alerts at 80% / 100% of limit (in-app + push) | D2 | Must |
| F11 | Digital vault ("caja fuerte") | D2 | Should |
| F12 | Digital twin wallet: 1- and 3-month projection + scenario simulator | D3 | Must |
| F13 | Mascot whose mood follows the wallet | D3 | Should |
| F14 | Awareness module: accumulated cost of ant expenses | D3 | Should |
| F15 | Weekly challenges and streaks | D3 | Could |
| F16 | In-app bug report | D3 | Should |

**Out of MVP:** income-group / team gamification, production bank connections (requires an aggregator contract and legal review), institutional advice channel (requires a university agreement), multi-currency, ML-based forecasting.

## 3. Functional requirements

Money is stored as integer minor units (`amountMinor`) in COP. Never use floats. This is reused from the existing backend (`backend/src/lib/money.ts`).

### F1 — Account and consent
- **FR-1.1** Sign up with email and password, with email verified by a one-time code. The Cognito password policy is reused.
- **FR-1.2** Before the first data write, the user accepts the data-processing policy (Habeas Data, Ley 1581 de 2012). Store `consentVersion` and `consentAt` on the profile. The API rejects writes with `403 consent_required` until consent is recorded.
- **FR-1.3** Users can sign out, reset their password, and delete their account. Deleting removes all items under `USER#<sub>` and revokes any Belvo link.
- **FR-1.4** A user can only ever read or write their own data. This is already enforced by `PK = USER#<sub>` from the verified token.

*Acceptance:* a new user signs up, accepts consent and logs their first expense in under 3 minutes.

### F2 — Onboarding: inflows and goal
- **FR-2.1** The user records one or more monthly inflows (allowance, salary, scholarship, other), each with an amount and an expected day.
- **FR-2.2** The user sets a monthly savings goal (amount), plus optional named goals with a target amount and date (e.g. "Viaje", "Portátil").
- **FR-2.3** As soon as a goal is created, the app shows today's safe-to-spend amount (F4).

### F3 — Quick expense entry
- **FR-3.1** An expense can be logged in ≤ 3 taps from home: amount → category → save. Description and date are optional; date defaults to today.
- **FR-3.2** Default student categories: `food` (Comida), `snacks` (Snacks y bebidas), `transport` (Transporte público), `rideshare` (Taxi / app), `parking` (Parqueadero), `outings` (Salidas), `academic` (Académico), `shopping` (Compras), `health` (Salud), `housing` (Vivienda), `subscriptions` (Suscripciones), `other` (Otros). Users can recategorize.
- **FR-3.3** Users can edit and delete transactions. Aggregates and projections refresh within 10 s.

### F4 — Safe to spend today
- **FR-4.1** `allowedMonthlySpend = Σ inflows(month) − savingsGoal(month)`.
- **FR-4.2** `safeToSpendToday = (allowedMonthlySpend − spentThisMonth − vaultDepositsThisMonth) / daysLeftInMonth` (today counts as a day left).
- **FR-4.3** If the value is ≤ 0, the home screen shows a red warning. The goal is at risk, and the screen shows the amount over.

*Acceptance:* the value matches a hand calculation on 5 seeded scenarios. Unit test in `backend/tests/unit`.

### F5, F6 — Belvo bank connection (sandbox)
- **FR-6.1** The user taps "Conectar banco". The app opens the Belvo Connect widget in a WebView using a short-lived access token issued by the backend. The user picks a sandbox institution and logs in with sandbox credentials.
- **FR-6.2** On success, the backend stores only the `belvoLinkId`, institution and account metadata, **never bank credentials**. Account status starts as `syncing`.
- **FR-6.3** The historical transactions fetch runs in the background (existing ingest queue). Status changes to `synced` or `failed` with a plain-language reason and a retry option.
- **FR-6.4** Belvo webhooks (`TRANSACTIONS` / `historical_update`, `new_transactions_available`) trigger incremental syncs.
- **FR-6.5** No duplicates after repeated syncs. Fingerprints come from the existing `lib/dedupe.ts`. A bank transaction that matches a manual entry (same amount, date ± 1 day, same category or merchant) is flagged as a possible duplicate, and the user picks which one to keep.
- **FR-6.6** Unlinking deletes the Belvo link (API `DELETE /api/links/{id}`). The user chooses whether to keep or delete the imported transactions (existing behavior).

### F7 — CSV import
- **FR-7.1** Reuse the existing CSV flow (`date,description,amount[,category]`, ≤ 5 MB / 10,000 rows) with a summary of imported, skipped and rejected rows. Imported rows are categorized.

### F8 — Dashboard
- **FR-8.1** Show this month's spend by category (bar or donut chart), weekly cumulative spend against the allowed pace line, and goal progress (%).
- **FR-8.2** Every number links to the transactions behind it.

### F9 — Categorization and ant expenses
- **FR-9.1** Belvo transactions use Belvo's `category` mapped to app categories. Fallback is the keyword categorizer (`lib/categorize.ts`, extended with local merchants such as "Rappi", "Uber", "DiDi", "Juan Valdez", "Oma", "Parqueadero"). Manual recategorization is remembered per merchant.
- **FR-9.2** *Ant expense*: a transaction with `amountMinor < antThreshold` (default COP 15,000, user-adjustable) in a category or merchant that appears ≥ 3 times in a rolling 7 days.
- *Acceptance:* ≥ 80% of the labeled test set (≥ 50 sandbox and seeded transactions) is categorized correctly.

### F10 — Spending alerts
- **FR-10.1** Trigger an alert when `spentThisMonth` crosses 80% and again at 100% of `allowedMonthlySpend`, and when today's spend exceeds `safeToSpendToday`. Each threshold fires once per period.
- **FR-10.2** Delivered as a home-screen banner and a push notification (Expo Push). Push requires a registered device token and user opt-in.
- **FR-10.3** The alert text names the action: "Te quedan $X para 12 días; si mantienes este ritmo, ahorrarás $Y de $Z".

### F11 — Vault
- **FR-11.1** The user moves money into or out of the vault. The vault balance is excluded from available money and counts toward the goal.

### F12 — Digital twin wallet
- **FR-12.1** Projects end-of-month savings, plus 1- and 3-month savings, from current habits. Model: the existing per-category weighted moving average with outlier dampening (`lib/forecast.ts`), combined with this month's pace so far and recorded inflows.
- **FR-12.2** Shows projected savings against the goal as on-track, at-risk or off-track, labeled as an estimate along with the months of history used.
- **FR-12.3** Scenario simulator: "¿Qué pasa si reduzco *categoría* un *N%*?" The new projection is recomputed on the device from the per-category forecast, with no server call.
- **FR-12.4** With fewer than 2 months of history, use this month's pace only and show "más datos = mejor predicción".

### F13 — Mascot
- **FR-13.1** Three moods derived from the twin status: happy (on track), worried (at risk), sad (off track). The mood changes as soon as the user meets or breaks the daily limit.

### F14 — Awareness module
- **FR-14.1** Shows the month-to-date and annualized total of ant expenses, as an amount and as a % of the savings goal ("Tus snacks de este mes = 35% de tu meta").

### F15 — Challenges and streaks
- **FR-15.1** The streak increases by 1 for each day the spend is ≤ that day's safe-to-spend, and resets otherwise. Computed by the existing daily scheduled job.
- **FR-15.2** One weekly challenge, chosen from a fixed list (e.g. "3 días sin taxi"). Progress comes from the user's transactions.

### F16 — Bug report
- **FR-16.1** A "Reportar un problema" button in Settings. It stores a feedback item (`FEEDBACK#<ts>`) with the app version and an optional screenshot. Feedback is reviewed by the operator.

## 4. Integrations

| Integration | Use | Notes |
|---|---|---|
| Amazon Cognito | Auth | Amplify v6 `Auth` in RN (SRP). New mobile app client. Tokens stored in SecureStore. |
| Belvo (sandbox) | Bank links, accounts, transactions, webhooks | Base URL `https://sandbox.belvo.com`. Secret ID/password stay server-side only (SSM). Connect widget runs in `react-native-webview`; the widget token comes from `POST /api/belvo/widget-token`. Webhook auth uses a shared `Authorization` header configured on the Belvo webhook. |
| Expo Push API | Alert notifications | `https://exp.host/--/api/v2/push/send`, called with plain `fetch` from the forecast worker. Free. Expo handles FCM/APNs. |
| EAS Build | iOS/Android builds | iOS build without a local Mac. Internal distribution for the usability tests. |

## 5. Architecture and infrastructure changes

The existing `FinanceStack` (us-east-1, CDK in `infra/stack.ts`) is kept. Changes:

```
Expo app ─▶ CloudFront /api/* ─▶ Lambda URL (api) ─▶ DynamoDB FinanceTable
Belvo ──webhook──▶ CloudFront /api/webhooks/belvo ─┘        │ stream
                                    stream-router ◀─────────┘
                                    ├─▶ ingest-queue   ─▶ ingest-worker   (Belvo / simulator / CSV, de-dup)
                                    └─▶ forecast-queue ─▶ forecast-worker (aggregates, twin, alerts, Expo push)
EventBridge Scheduler (daily) ─▶ forecast-worker (refresh, streaks)
```

| # | Change | Where |
|---|---|---|
| I1 | Add a Cognito `UserPoolMobileClient` (no secret, SRP + refresh). The JWT verifier accepts both clients (`clientId: [web, mobile]`). | `infra/stack.ts`, `backend/src/lib/auth.ts` |
| I2 | Belvo secrets in SSM Parameter Store SecureString: `/xpense/belvo/secret-id`, `/xpense/belvo/secret-password`, `/xpense/belvo/webhook-token`. Read-only IAM for the api and ingest-worker. Secrets Manager is not used because it costs $0.40/secret/month. | `infra/stack.ts` |
| I3 | `POST /api/webhooks/belvo` route on the existing API Lambda. It bypasses Cognito, checks the webhook token with a timing-safe comparison, and writes a sync job that stream-router sends to ingest-queue. No new Lambda. | `backend/src/api.ts` |
| I4 | Ingest worker gains source `belvo`: it pages `/api/transactions/?link=` from Belvo and maps the results to transactions. The simulator stays for offline demos. | `backend/src/ingest-worker.ts`, new `backend/src/lib/belvo.ts` |
| I5 | Forecast worker computes the twin projection, evaluates alert thresholds, writes `ALERT#` items and sends Expo push. Daily mode also updates `STREAK`. | `backend/src/forecast-worker.ts` |
| I6 | Old web SPA removed. The CloudFront and SiteBucket deployment now ships only a static `privacy.html` (privacy policy and terms, needed for Ley 1581 and the app stores). | `infra/stack.ts`, new `site/` |
| I7 | Enable DynamoDB point-in-time recovery. Needed for the backup and recovery checklist item; the restore test is in activity 3.6. Cost ≈ $0 at MVP size. | `infra/stack.ts` |
| I8 | `-c alertEmail=<team email>` becomes mandatory on deploy. The live stack still points SNS and the Budget at `you@example.com`. | `infra/stack.ts`, README |

**Not added on purpose:**
- API Gateway: its free tier lasts only 12 months.
- SNS mobile push: still needs FCM/APNs setup. Expo already wraps that.
- Secrets Manager: cost.
- SageMaker, Bedrock or ML: the weighted moving average is the twin's model for the MVP. Revisit after the MVP when there are ≥ 6 months of real user history.

## 6. Data model deltas

Single table, `PK = USER#<sub>`:

| Item | SK | Key fields |
|---|---|---|
| Profile (extended) | `PROFILE` | `+ consentVersion, consentAt, currency="COP", antThresholdMinor, pushOptIn` |
| Inflow | `INCOME#<id>` | `name, kind (allowance/salary/scholarship/other), amountMinor, dayOfMonth` |
| Goal | `GOAL#<id>` | `name, targetMinor, targetDate?, monthly (bool)` |
| Vault | `VAULT` | `balanceMinor` (movements are `savings` transactions with `vault=true`) |
| Account (extended) | `ACCT#<id>` | `source + "belvo", belvoLinkId, institution` |
| Device | `DEVICE#<expoPushToken>` | `platform, createdAt` |
| Alert | `ALERT#<yyyy-mm>#<kind>` | `kind (pct80/pct100/daily#<date>), firedAt, message` (the SK makes each alert fire once) |
| Streak | `STREAK` | `current, best, lastEvaluatedDate, weeklyChallenge{id, progress}` |
| Twin | `FORECAST` (extended) | `+ projectedMonthEndSavingsMinor, status (on_track/at_risk/off_track)` |
| Feedback | `FEEDBACK#<ts>` | `message, appVersion, screenshotKey?` |
| Belvo link index | `PK=BELVOLINK#<linkId>`, `SK=USER` | `sub`. Lets a webhook be resolved to its user without a scan. |

## 7. API deltas

All routes are under `/api`, require a Cognito token (except webhooks), and are scoped to the token's `sub`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/me/consent` | Record consent version |
| GET/POST/PUT/DELETE | `/incomes[/{id}]` | Inflows CRUD |
| GET/POST/PUT/DELETE | `/goals[/{id}]` | Goals CRUD |
| POST | `/vault/deposit`, `/vault/withdraw` | Vault movements |
| GET | `/summary` | Safe-to-spend, month totals, alerts, twin status, mascot mood, streak (single home-screen call) |
| POST/DELETE | `/devices[/{token}]` | Register or unregister a push token |
| POST | `/belvo/widget-token` | Short-lived Connect widget token |
| POST | `/belvo/links` | Register a link created in the widget, which starts the sync |
| POST | `/webhooks/belvo` | Belvo webhook (token-authenticated) |
| POST | `/feedback` | Bug report |

Existing routes are unchanged: `/me`, `/transactions`, `/accounts`, `/accounts/{id}/sync`, `/imports`, `/jobs/{id}`, `/insights`. See `specs/001-serverless-finance-tracker/contracts/openapi.yaml`.

## 8. Mobile app (Expo)

- `mobile/` is created with `create-expo-app`, using Expo Router.
- Screens: Auth, Consent, Onboarding (inflows → goal), Home (safe-to-spend, mascot, alerts, quick-add), Movimientos, Dashboard, Gemelo (projection + simulator), Cuentas (Belvo / CSV), Ajustes (vault, threshold, notifications, feedback, delete account).
- Libraries, kept to a minimum: `aws-amplify` (Auth), `expo-secure-store`, `expo-notifications`, `react-native-webview`, `expo-document-picker` (CSV). A chart library only if the native views aren't enough.
- All UI strings are in one `es-CO` strings file. No i18n framework until a second language is needed.
- Colors follow the Capstone palette (white smoke background, green-yellow secondary, light green accents).

## 9. Non-functional requirements

- **NFR-1 Cost**: stay within the AWS free tier; the existing Budget alarm is the backstop. Belvo sandbox is free.
- **NFR-2 Security**:
  - No bank credentials are stored.
  - Belvo secrets live only in SSM.
  - Tokens are kept in SecureStore.
  - Logs never contain tokens, amounts tied to an email, or account numbers (existing `lib/log.ts` rules).
- **NFR-3 Privacy**: Ley 1581 consent, a privacy policy URL, and account deletion that removes all data.
- **NFR-4 Performance**: `/summary` p95 < 1 s. A sync of ≤ 1,000 transactions is visible within 60 s.
- **NFR-5 Accessibility**: labels on all touch targets, minimum touch size 44 pt, contrast ≥ 4.5:1, dynamic font size respected.
- **NFR-6 Platforms**: Android 10+ and iOS 16+, tested on at least one physical device each.
- **NFR-7 Observability**: reuse the correlation id across the app → API → workers. Key events (expense logged, bank linked, alert fired) appear in the logs.

## 10. Success criteria

- SC-1: SUS score ≥ 68 with 5 students (activity 3.3 / 3.5).
- SC-2: An expense is logged in ≤ 3 taps (observed in usability tests).
- SC-3: Categorization is ≥ 80% correct on the labeled test set.
- SC-4: 80% and 100% alerts fire exactly once per month in seeded scenarios. Daily alerts fire once per day.
- SC-5: Zero duplicates after repeated Belvo syncs and webhook deliveries.
- SC-6: The twin projection stays within 20% of actual month-end savings for seeded 6-month histories.

## 11. Risks and open questions

- **Belvo Colombia sandbox coverage**: confirm which `erebor_co_*` test institutions return transactions. The fallback is the Mexican sandbox institutions, relabeled for the demo.
- **Connect widget in a WebView**: confirm that the success callback (redirect or `postMessage`) is caught reliably on iOS and Android. The fallback is opening it in the system browser with a deep link (`xpense://belvo`).
- **iOS distribution** needs an Apple developer account for EAS internal builds. The fallback is Expo Go for demos.
- **Ant-expense threshold** (COP 15,000 default) should be validated with students in the usability tests.
- **Live stack drift**: the deployed `FinanceStack` was deployed with `smoke`, `allowPoison` and SPA context flags. Running `cdk diff` from this repo currently shows those as removals. The next deploy should be intentional (I6, I8).
