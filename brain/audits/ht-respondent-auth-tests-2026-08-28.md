# HT Respondent Frontend — Auth Tests (Tranche 1)

**Date:** 2026-08-28
**Branch/PR:** `deepseek/ht-respondent-auth-tests`
**Scope:** AUTH ONLY — explicitly EXCLUDES onboarding screens (`invalid-card-ctrlr.ts`, `completed-ctrlr.ts`, `about.ctrlr.ts`, and the `.onboarding-message` markup in `auth-ctrlr.ts`/`used-card-ctrlr.ts`). The pure auth logic (`src/auth.factory.ts`) and the root-route `AuthController` are fully covered.
**Related audit:** `brain/audits/ht-respondent-auth-exploration-2026-08-28.md`

---

## 1. What was added

### Test runner (vitest)
- `frontend-respondents/package.json`
  - Added `vitest` (^4.1.11) to `devDependencies` (Vite 7 + ESM + TS compatible).
  - Replaced the `"test"` stub (`echo "Error: no test specified" && exit 1`) with `"test": "vitest run"`.
- `frontend-respondents/vitest.config.ts` — Node environment (logic tests, **no jsdom**), includes `src/**/*.test.ts`, mirrors the vite React neutralization alias via `src/empty-module.ts`, wires `test/setup.ts`.
- `frontend-respondents/test/setup.ts` — minimal Node-side browser-global stubs (`localStorage`, `window`, `document`, `alert`). Installed before the module graph loads so import-time global reads (e.g. `src/state/store.ts` constructing `UserStore`, which reads `localStorage`) work without jsdom. Tests override `window.location.href` / `alert` per case.
- `pnpm-lock.yaml` — updated for the new vitest dependency.

### Test files (the deliverable)
| File | Coverage |
|---|---|
| `src/auth.factory.test.ts` | Unit tests for `authenticate()` + `hasParticipatingAccount()` via a hand-built fake `IServices` |
| `src/controllers/auth-ctrlr.test.ts` | Controller tests for the root-route auth + registration flow |
| `src/card-signature.seam.test.ts` | Frontend-integration test of the shared card-encoding seam (relative source import) |
| `src/test/setup.ts` | shared global stubs (lives under `test/`) |

---

## 2. auth.factory unit tests (`src/auth.factory.test.ts`)

A fake `IServices` (`{ viem, waap, account, ipfs, lit, nillDB, oprf }`) is constructed per test. It never touches the `ServiceContainer` singleton / `getServices()`, never reads `window.waap`, and never makes network calls. Mocked at minimum: `waap.login`, `waap.signMessage`, `oprf.getSecp256k1`, `account.updateSignerWithKey`, `account.getSignerAddress`, `viem.read`. The shared package source import inside `auth.factory.ts` (`../../shared/src/shared`) is stubbed via `vi.mock` because the functions under test never call `fetchSurvey` — keeping the unit test free of Lit/Nillion/d3.

Covered cases (9 tests):
- `authenticate` happy path walks `login → signMessage → getSecp256k1 → updateSignerWithKey → hasParticipatingAccount` and returns `true` when already a participant.
- `authenticate` returns `false` when the derived participant is not an on-chain pool member.
- `hasParticipatingAccount` returns `false` (with no `viem.read` call) when `getSignerAddress() === '0x'`.
- `hasParticipatingAccount` reads `isPoolMember` via `viem.read` with `[poolId, signerAddress]` and the real committed address/abi from `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` (resolved via the workspace exports map).
- Error propagation: `waap.login` / `waap.signMessage` / `oprf.getSecp256k1` / `account.updateSignerWithKey` each rejecting propagates and short-circuits the flow.

---

## 3. AuthController tests (`src/controllers/auth-ctrlr.test.ts`)

`AuthController` (bound to the root route `/`) is exercised in the Node environment. The router (Navigo), `Card`/`parseCardURL`/`fetchSurvey` (`@s3ntiment/shared`), `@s3ntiment/shared/components`, `authenticate`, `removeSplash` are mocked; `window`/`document`/`alert`/`localStorage` are stubbed — **no jsdom**.

Covered cases (5 tests):
- **Happy path**: `parseCardURL(url)` → `fetchSurvey(services, surveyStore, surveyId)` → `store.setSurveyData(surveyId, { id, pool })` → `authenticate(services, poolId)` → not a participant → `card.register(services, surveyStore, poolId)` (on-chain `registerInPool`, awaiting the receipt) → `router.navigate('/surveys/:surveyId')`.
- **Already-participant shortcut**: `authenticate` returns `true` → navigates straight to `/surveys/:surveyId`, and `card.register` is **not** called.
- **Receipt not success** → `alert`, no navigation.
- **`card.register` rejects** → `alert`, no navigation.
- **No card on URL** (`parseCardURL` → `null`) → no fetch / authenticate / register / navigate.

---

## 4. Shared-encoding seam usage (user priority, item 4)

`src/card-signature.seam.test.ts` imports the shared card-encoding module by **direct relative source path**, mirroring the precedent already in `src/auth.factory.ts` (`import { fetchSurvey } from "../../shared/src/shared"`):

```ts
import { cardMessageHash, ethSignedMessageHash, signCardMessage } from '../../shared/src/shared/invites/encoding.js';
import { parseCardURL } from '../../shared/src/shared/invites/card.factory.js';
```

This resolves to the shared `.ts` source — the test depends on **source, not the unbuilt `shared/dist`**. It pins the same seam the contract tests already pin (`contracts/test/encoding.seam.test.ts`) and that the auth flow relies on. Covered cases (5 tests):
- `cardMessageHash` matches `keccak256(abi.encodePacked(nullifier, "|", batchId))`.
- `ethSignedMessageHash` wraps the digest in the EIP-191 `\x19Ethereum Signed Message:\n32` envelope.
- **Round-trip**: `signCardMessage(account, nullifier, batchId)` → `recoverMessageAddress({ message: { raw: cardMessageHash(...) }, signature })` recovers the `batchId`. This is the card-signature → owner-recovery the on-chain `registerInPool` and shared `parseCardURL` rely on.
- Real `parseCardURL` (from `card.factory.ts` source) recovers `surveyOwner == batchId` from a signed card URL — the auth flow entry point.
- Missing-param card URL returns `null`.

---

## 5. Onboarding exclusions honored

- No tests written for `invalid-card-ctrlr.ts`, `completed-ctrlr.ts`, `about.ctrlr.ts`, or the `.onboarding-message` markup in `auth-ctrlr.ts`/`used-card-ctrlr.ts`.
- The `authenticate()` / `hasParticipatingAccount()` calls those screens make are covered via `src/auth.factory.ts`.

---

## 6. Green gates (run by the author)

```
$ pnpm --filter frontend-respondents test
Test Files  3 passed (3)
     Tests  19 passed (19)

$ pnpm --filter frontend-respondents build
✓ 6979 modules transformed.
✓ built in 39.74s
```

- **Collected:** 19 tests across 3 files
- **Passed:** 19/19
- **Build:** green

Per-file counts:
- `src/auth.factory.test.ts` — 9 passed
- `src/controllers/auth-ctrlr.test.ts` — 5 passed
- `src/card-signature.seam.test.ts` — 5 passed

Installation used `pnpm install` (workspace links `@s3ntiment/shared`, `s3ntiment-contracts` resolve) and `pnpm build:shared` (tsc) — shared `dist` is produced but **gitignored**; the tests use the relative source seam so they do not depend on it at runtime.

---

## 7. Notes
- `shared/dist/` and `frontend-respondents/dist/` are gitignored and are not part of the PR.
- The committed deployment JSON `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` resolves via the workspace exports map (`./deployments/*`) with `with { type: 'json' }`, exercised in both the auth.factory and controller tests.
