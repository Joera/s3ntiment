# Report — nillcc-backend boundary validation + validation tests + testable app factory

**Date:** 2026-09-02
**Branch:** `nillcc/backend-validation`
**Worktree:** `~/code/s3ntiment/worktrees/s3ntiment-nillcc-backend-validation` (off `main` @ `bc1c57499`, clean)
**Status:** IMPLEMENTED — all gates green. PR open against `main`; NOT merged (per task: do not merge).
**Scope:** `@s3ntiment/nillcc-backend` only. No changes to shared / organiser / respondents / contracts source.

## Deliverable

Three new/edited files in `nillcc-backend/src/`:

1. **`src/app.ts` (new)** — `createApp(services)` Express app factory. Builds the full wired app
   (cors → json/urlencoded → dead `verifySignature` middleware → routes → `/api` mount → 404 fallback)
   **without booting anything**: no env reads, no service construction, no `initStorage()` /
   `nildb.initBuilder()`, no `listen()`. Imports `express`, `cors`, `viem`, `s3ntiment-contracts/constants`,
   and the in-package `NillionPkpClient` (all pure, importable, offline).
2. **`src/validation.ts` (new)** — hand-rolled, zero-dependency boundary validators. A tiny declarative
   field walker (`validateBody`) + one exported validator per mutating route. Required-field + type checks
   that run at the route boundary and return **`400 { error, message }` BEFORE any side effect**
   (service call / Lit / NilDB / IPFS / chain access / store write). No new dependencies (no zod/ajv).
3. **`src/main.ts` (edited)** — runtime behavior identical to before: env reads and service construction
   stay at module top-level, `await initStorage()` and `await nildb.initBuilder()` still run, then
   `createApp(...)` and the same `startServer()`/`console.log("kip")` startup. Only the middleware/route
   block moved into `app.ts`.
4. **`src/app.test.ts` (new)** — focused route-boundary tests per mutating route: missing arg → 400 with
   expected message, wrong type → 400, valid payload → passes through to the handler (fake services are
   `vi.fn`s asserted on). No new devDeps: exercises the app over real HTTP via Node's built-in `fetch`
   on an ephemeral port (`app.listen(0)`), mocks the gitignored `s3ntiment-contracts/constants`, the
   in-package `NillionPkpClient`, and `viem`'s `verifyMessage` (used by `/score`). Follows the existing
   vitest conventions (hoisted `vi.mock` + comment style from `pool.ctrlr.test.ts` / `survey.ctrlr.test.ts`).

## Route-validation coverage table

| Route | Validator | Required (with type) | 400 on |
|---|---|---|---|
| `POST /api/pools` | `validatePoolCreate` | signature (str), userAddress (str), poolId (str), safeAddress (str) | missing poolId → `MISSING_FIELD` / "missing poolId"; missing safeAddress → "missing safeAddress"; wrong type → `INVALID_FIELD_TYPE` |
| `POST /api/surveys` | `validateSurveyCreate` | signature, userAddress (str); surveyConfig (obj: id, pool str); poolConfig (obj: **pkpId, pkpDid, safe**) | missing/partial poolConfig → `MISSING_POOL_CONFIG` (message preserved verbatim); missing field → `MISSING_FIELD`; wrong type → `INVALID_FIELD_TYPE` |
| `PUT /api/surveys/:id` | `validateSurveyUpdate` | survey (obj), poolConfig (obj — fields NOT required) + URL-id vs `surveyConfig.id` | id mismatch / missing surveyConfig → `SURVEY_ID_MISMATCH` (code preserved); missing survey → `MISSING_FIELD`; wrong type → `INVALID_FIELD_TYPE` |
| `POST /api/surveys/:id/score` | `validateScore` | signature, signer, poolId (str) | `MISSING_FIELD` / `INVALID_FIELD_TYPE` |
| `POST /api/surveys/:id/results` | `validateResults` | auth (obj), survey=queryIds (array), poolId (str), poolConfig.safe (str) | `MISSING_FIELD` / `INVALID_FIELD_TYPE` |
| `POST /api/surveys/:surveyId/delegation` | `validateDelegation` | userDid, signature, userAddress, poolId (str); poolConfig.safe/pkpId/pkpDid (str) | `MISSING_FIELD` / `INVALID_FIELD_TYPE` |
| `POST /api/builder/register` | `validateRegisterBuilder` | signature, userAddress, poolId, pkpId, pkpDid, safeAddress (str) | `MISSING_FIELD` / `INVALID_FIELD_TYPE` |
| `POST /api/lit/usage-key` | `validateUsageKey` | userAddr, signature, poolId (str) | `MISSING_FIELD` / `INVALID_FIELD_TYPE` |

`GET /api/surveys/:id` is read-only → not validated (out of scope). `PoolController.update` has **no
route** (no `PUT /api/pools` exists), so nothing to validate there beyond the create route.

## Alignment with PR #38 (Pool.config optional)

- **No validator requires a full `PoolConfig`** (`safe/chainId/litNetwork/pkpId/pkpDid/groupId`).
- Survey-**create** keeps requiring `poolConfig.pkpId/pkpDid/safe` — the canonical enforcement point
  for minted pool identity; the boundary returns it as `400 MISSING_POOL_CONFIG` with the exact
  controller message instead of the previous thrown-500.
- Survey-**update** requires `survey` and `poolConfig` as objects only — **no** pkpId/pkpDid/safe on the
  update path (imported pools may legitimately lack them).
- Routes that functionally need specific config fields require exactly those: results → `safe`;
  delegation → `safe`+`pkpId`+`pkpDid` (needed for the PKP write delegation).

## Behavioural changes (intentional)

1. **`MISSING_POOL_CONFIG` on `POST /api/surveys` now returns `400`** instead of a thrown error surfacing
   as `500 { error: 'CREATE_FAILED', detail: 'MISSING_POOL_CONFIG: …' }`. Message preserved verbatim.
   The in-controller guard is untouched (still throws for direct controller calls, e.g. unit tests).
2. **`SURVEY_ID_MISMATCH` on `PUT /api/surveys/:id` keeps its `400` + error code**, now also carries a
   human-readable `message` field (was `{ error: 'SURVEY_ID_MISMATCH' }` only). Additive; clients keyed
   on `error` are unaffected.
3. **New 400s where callers previously got cryptic 500s**: missing `survey`/`poolConfig` on update,
   missing signature/signer/poolId on score, missing auth/queryIds/poolConfig.safe on results, etc. —
   now a clean `MISSING_FIELD` / `INVALID_FIELD_TYPE` before any side effect.
4. No route responses changed for otherwise-valid payloads; happy-path status codes (201/200) unchanged.

## Intentionally-unwired `verifySignature` / auth

The dead `verifySignature` middleware (formerly main.ts ~50-57) is **preserved verbatim inside
`createApp` and intentionally NOT wired to any route** in this PR. Auth wiring is a **separate follow-up**
— out of scope by design, so this PR stays boundary-validation only.

## Green gates (run in the worktree)

```
pnpm --filter @s3ntiment/nillcc-backend test      → Test Files 5 passed (5), Tests 61 passed (61)
pnpm --filter @s3ntiment/nillcc-backend build     → tsc, exit 0
pnpm --filter @s3ntiment/shared test              → Test Files 11 passed (11), Tests 103 passed (103)
pnpm --filter @s3ntiment/shared build             → tsc, exit 0
```

Baselines (pre-change, same worktree): backend 29 tests / 4 files; shared 103 / 11 — shared unchanged.

## No new dependencies / hygiene

- No deps added (validation is hand-rolled; tests use built-in `fetch`, no supertest).
- No stray files; `git status` shows exactly `M nillcc-backend/src/main.ts` +
  `?? src/app.ts, src/validation.ts, src/app.test.ts`.
- No debug instrumentation added (existing console.logs in routes preserved to keep runtime behavior).
- Main checkout untouched — all work in the dedicated worktree.
