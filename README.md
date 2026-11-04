# Xpense

Financial-habits app for university students: log or sync expenses (Belvo sandbox), see a daily
safe-to-spend amount, get warned when spending threatens the month's savings goal, and project
the outcome with a digital twin wallet. Spec: [`requirements.md`](requirements.md).

## Layout

| Path | What |
|---|---|
| `mobile/` | Expo / React Native app (Android, iOS). `cd mobile && npm install && npx expo start` |
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
npm run deploy -- -c alertEmail=team@example.com
```

`.origin-secret` (gitignored) pins the CloudFront→API shared secret; keep it locally so redeploys
don't rotate it. Operator runbook and cost ledger: see `specs/001-serverless-finance-tracker/quickstart.md`.
