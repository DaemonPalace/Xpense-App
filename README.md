# Xpense

Financial-habits app for university students: log or sync expenses (Belvo sandbox), see a daily
safe-to-spend amount, get warned when spending threatens the month's savings goal, and project
the outcome with a digital twin wallet. Spec: [`requirements.md`](requirements.md).

## Layout

| Path | What |
|---|---|
| `mobile/` | Expo / React Native app (Android, iOS) |
| `backend/` | Lambda handlers (api, stream-router, ingest-worker, forecast-worker) + unit tests |
| `infra/` | AWS CDK stack `FinanceStack` |
| `specs/001-serverless-finance-tracker/` | Original backend spec, data model, OpenAPI contract |

## Backend

Prerequisites: Node.js 22+, AWS CLI credentials, `npx cdk bootstrap` once per account/region.

```bash
npm ci
npm test
npm run typecheck
npm run diff                                    # compare with deployed stack
npm run deploy -- -c alertEmail=<operator email>   # required
```

`.origin-secret` (gitignored) pins the CloudFront→API shared secret; keep it locally so redeploys
don't rotate it. Operator runbook and cost ledger: see `specs/001-serverless-finance-tracker/quickstart.md`.

## Mobile

```bash
cd mobile
npm install
cp .env.example .env      # fill from stack outputs: SiteUrl, UserPoolId, MobileClientId
npx expo start            # scan the QR code with Expo Go
npm run typecheck && npx expo lint
```

Sign-in uses Cognito SRP (`amazon-cognito-identity-js`), so it runs in Expo Go without a dev build.

UI: design system from the team's Xpense_AI prototype (NativeWind + Plus Jakarta Sans), wired to the API.

| Route | What |
|---|---|
| `sign-in`, `sign-up`, `reset-password` | Cognito auth |
| `consent`, `onboarding` | Habeas Data consent, monthly income + savings goal (gated in `(tabs)/_layout.tsx`) |
| `(tabs)/hoy` | Safe-to-spend today, goal progress, alerts, 7-day chart, ant expenses, recent movements |
| `(tabs)/gemelo` | Digital twin: month plan, 1/3-month forecast (`/api/insights`), habit simulator |
| `(tabs)/comida` | Meal ideas within the per-meal budget |
| `(tabs)/movimientos` | Month list (long-press delete, ant filter) and month summary by category |
| `perfil` | Vault deposit/withdraw, plan, ant threshold, sign out, delete account |
| `cuentas` | Test bank accounts and CSV import |

Global sheets (new expense, plan, savings deposit) and the toast live in `src/components/overlays.tsx`;
server state lives in `src/data-context.tsx`.
