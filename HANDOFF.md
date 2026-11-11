# Handoff: Xpense consolidation (2026-11-11)

Branch `integrate-xpense-ai` (not yet committed or merged). Read this before touching the mobile app or the stack.

## Where things live now

| Folder (`../Capstone/`) | Status |
|---|---|
| `xpense-app/` | **The project.** Backend, CDK infra, specs and the mobile app. GitHub: `DaemonPalace/Xpense-App`. |
| `Speckit-Project/` | Archived. Original backend + web SPA. **Never deploy from it**: its stack has no `MobileClient` or `custom:institution`, so a deploy would break mobile sign-in. |
| `Xpense_AI/` | Team's UI prototype (`FerminEscalona/Xpense_AI`), mock data only. Its design now lives in `xpense-app/mobile`. Only change: `react-dom` pinned to `19.3.0` to fix `npm install` (uncommitted). |

## What changed on this branch

**Mobile UI.** `xpense-app/mobile` now uses the Xpense_AI design (NativeWind + Plus Jakarta Sans) wired to the real API.
Old screens (`dashboard`, `settings`, `vault`, `accounts`, `movements`, `add`) were folded into the new routes:

| Route | Data source |
|---|---|
| `sign-in`, `sign-up`, `reset-password` | Cognito SRP (`src/lib/cognito.ts`) |
| `consent`, `onboarding` | `POST /api/me/consent`, `/api/incomes`, `/api/goals`; gated in `src/app/(tabs)/_layout.tsx` |
| `(tabs)/hoy` | `/api/summary` + `/api/transactions` (7-day chart, tap a bar for that day) |
| `(tabs)/gemelo` | summary + `/api/insights` forecast, client-side habit simulator |
| `(tabs)/comida` | static meals (`src/lib/meals.ts`), budget = 55% of daily limit |
| `(tabs)/movimientos` | month list (long-press delete, ant filter); month summary (tap a 5-day bar) |
| `perfil` | vault deposit/withdraw, plan, ant threshold, sign out, delete account |
| `cuentas` | test bank + CSV import |

Key files: `src/components/ui.tsx` (design system), `src/components/overlays.tsx` (expense/plan/saving sheets, toast),
`src/data-context.tsx` (server state; remounts on sign-in/out), `src/lib/password.ts` (password rules).

**UX fixes requested on 2026-11-11.**
- The keyboard no longer covers inputs: `KeyboardAvoidingView behavior="padding"` on both platforms (Android is edge-to-edge in SDK 58) and `tabBarHideOnKeyboard`.
- Sheets: the backdrop fades and the panel slides (Reanimated `SlideInDown`).
- Every password field has a show/hide button. Sign-up and reset show a live rule checklist and say which rules fail.
- Sign-up asks for given name, family name and institution (dropdown).
- The Hoy bank prompt sits at the top. Its X hides it; tapping the rest opens `cuentas`.

**Infra (deployed 2026-11-11).** `infra/stack.ts` adds the Cognito custom attribute `custom:institution` (string, 1–100).
`cdk diff` showed an in-place update. After the deploy the pool kept its 4 users. **Custom attributes can never be renamed
or removed**, so don't add more casually.

## Run it

```bash
cd xpense-app && npm ci && npm test            # backend: 82 tests
cd mobile && npm install && npx expo start     # scan the QR with Expo Go
npx tsc --noEmit && npx expo lint              # must stay clean
```
`mobile/.env` (gitignored) must match the stack outputs: `SiteUrl`, `UserPoolId`, `MobileClientId`.

Deploy (use the operator email, otherwise the alarms and budget emails move to another address):
```bash
cd xpense-app && npm run deploy -- -c alertEmail=<operator email>
```

## Operator tasks (added 2026-11-11, need a deploy first)

Read bug reports (F16, `POST /api/feedback`, sent from Mi perfil):
```bash
aws dynamodb scan --table-name <FinanceTable name> --filter-expression "begins_with(SK, :f)" \
  --expression-attribute-values '{":f":{"S":"FEEDBACK#"}}' --query 'Items[].[createdAt.S,appVersion.S,message.S]' --output text
```

Backup restore test (point-in-time recovery is on; a restore always creates a new table):
```bash
aws dynamodb restore-table-to-point-in-time --source-table-name <FinanceTable name> \
  --target-table-name xpense-restore-test --use-latest-restorable-time
aws dynamodb wait table-exists --table-name xpense-restore-test
aws dynamodb scan --table-name xpense-restore-test --select COUNT   # compare with the live table
aws dynamodb delete-table --table-name xpense-restore-test          # a second table is outside the free tier: delete it right away
```

Privacy policy and terms: `site/privacy.html`, served at `<SiteUrl>/privacy.html` and linked from the consent screen and Mi perfil.
Bump `CONSENT_VERSION` in `mobile/src/strings.ts` when it changes.

## Verified vs not verified

- ✅ Typecheck, lint, `expo export --platform android`, backend tests, deploy, attribute present.
- ❌ **Not tested on a device.** Nobody has walked through sign-up → confirm → onboarding → Hoy against the live stack yet. Do this first.
- ❌ Keyboard behavior inside the `Sheet` modal on Android: expected to work with `padding`. If it doesn't, adopt `react-native-keyboard-controller` (needs a dev build).

## Known gaps / next steps

1. **Commit and open a PR** for `integrate-xpense-ai`. Also commit or PR the `react-dom` fix in `Xpense_AI`.
2. **Institution isn't validated server-side.** Any string can be sent to Cognito. Add a pre-sign-up Lambda when more institutions exist (list in `mobile/src/strings.ts` `INSTITUTIONS`).
3. **Name only shows after a fresh sign-in.** `given_name` is read from the ID token at sign-in; sessions saved before this change show the email.
4. **Manual vs synced de-dup (FR-6.x) is not implemented.** Sync de-dup uses fingerprints within one account only, so a manual lunch and a synced lunch both count.
5. **Not built yet:** mascot (F13), streaks/challenges (F15). Bug reports (F16) have no screenshot. The prototype's "Día" (hourly) view was dropped because transactions have no time of day.
6. **Plan sheet edits only the first income and the first monthly goal** (`ponytail:` comment in `overlays.tsx`).
7. **Password rules exist twice**: `mobile/src/lib/password.ts` and `infra/stack.ts` `passwordPolicy`. Change both.
8. **Unused deps** left in `mobile/package.json` from the old app: `@expo/ui`, `expo-symbols`, `expo-glass-effect`, `expo-image`. Remove them once confirmed unused.
9. **Real bank aggregator:** blocked on Prometeo/Floid sandbox access (`requirements.md` §11). It plugs in as a new `source` in `backend/src/ingest-worker.ts`.
