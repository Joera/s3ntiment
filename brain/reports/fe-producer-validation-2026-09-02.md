# Report — Frontend producer-side validation for nillcc-backend payloads + tests

**Date:** 2026-09-02
**Branch:** `deepseek/fe-validation`
**Worktree:** `~/code/worktrees/s3ntiment/fe-validation` (off `origin/main` @ `c2ced2575`, clean)
**Status:** IMPLEMENTED — all gates green. PR open against `main`; NOT merged (per task: do not merge).
**Base note:** branched off `main` = PR #39 (backend boundary validation) merged, PR #40 (auth wiring) NOT merged. So the backend gate base is **61 tests / 5 files (pre-#40)**.

## What this closes

PR #39 added backend route-boundary validation (`nillcc-backend/src/validation.ts` + `app.test.ts`),
but the PRODUCER side (the two frontends that build and send the payloads) was never covered: the
frontends could still construct/send payloads the backend rejects (400/401) — including the #37 bug
class (FE built `surveyConfig` with no `poolConfig` → backend crash). This PR validates each payload at
the point of construction/submit on the frontends so a payload the backend will reject is never
produced/sent (fail-fast), with tests per caller.

## Placement decision (and rationale)

**Validators live in `@s3ntiment/shared` — one module, `shared/src/shared/nillcc-validation.ts`**,
re-exported from `shared/src/shared/index.ts`. Both frontends already depend on and import from
`@s3ntiment/shared`, so a single module gives organiser + respondents the SAME contract with zero
duplication and zero new dependencies. The backend keeps its own copy in `nillcc-backend/src/validation.ts`
and is **untouched** (refactoring it to re-export from shared would change its test counts / behavior;
the gate is that backend stays green at its baseline). So: shared is a faithful producer-side mirror of
the backend boundary schemas, deliberately duplicated rather than cross-referenced — the backend remains
the authority; this just makes it impossible to ship a malformed payload to the wire.

### #40-aligned supersets (the ONLY intentional deviations from the backend copy)
PR #40 (auth wiring, not on this base) adds signature verification on every mutating route. The backend
`#39` schemas already require `signature`/`userAddress` for pool/survey/builder/score/usage-key/delegation,
but NOT for `results` (only `auth` must be an object) and NOT for `survey update`. The shared validators
add those two #40 checks so a payload the backend will 401 on after #40 is also caught locally:
- `validateResults` also requires `auth.signature` + `auth.userAddress`.
- `validateSurveyUpdate` also requires `signature` + `userAddress`.

This is what makes the alignment real: no frontend caller ships a payload the backend (#40) would 401 on.

## Per-caller coverage table

| Frontend caller | Route | Validator | Wired before send | FE satisfied by #40? |
|---|---|---|---|---|
| organiser `new.ctrlr` | `POST /api/pools` | `validatePoolCreate` | ✅ guardValid | ✅ sends `signature`("Request owner invocation") + `userAddress` |
| organiser `new.ctrlr` | `POST /api/builder/register` | `validateRegisterBuilder` | ✅ guardValid | ✅ sends `signature` + `userAddress` |
| organiser `new.ctrlr` | `POST /api/surveys` | `validateSurveyCreate` | ✅ guardValid | ✅ sends `signature` + `userAddress` |
| organiser `survey.ctrlr` | `POST /api/surveys/:id/results` | `validateResults` | ✅ guardValid | ✅ `auth.signature`+`auth.userAddress` (authObject) — body fixed to send `survey` = queryIds array (was `queryIds`) |
| organiser `survey.ctrlr` | `PUT /api/surveys/:id` | `validateSurveyUpdate` | ✅ guardValid | ✅ **fixed this caller**: it previously sent NO signature/userAddress and a body (`{surveyId,surveyConfig,safeAddress,poolId}`) that matched neither #39 nor #40; now sends `{signature,userAddress,survey,poolConfig,surveyConfig:{id}}` |
| respondents `survey.ctrlr` | `POST /api/surveys/:id/delegation` (submit) | `validateDelegation` | ✅ | ✅ sends `signature`(`s3ntiment:submit`) + `userAddress` |
| respondents `account-ctrlr` | `POST /api/surveys/:id/delegation` (migrate) | `validateDelegation` | ✅ | ✅ sends `signature`(`s3ntiment:migrate`) + `userAddress` |
| respondents `completed-ctrlr` | `POST /api/surveys/:id/score` | `validateScore` | ✅ | ✅ unchanged inline (signature+signer) |
| shared `lit/keys.ts` `fetchLitApiKey` | `POST /api/lit/usage-key` | `validateUsageKey` | ✅ throwOnFailure | ✅ unchanged inline (signature+userAddr); used by both FEs via survey.factory |

## Caller that could NOT be satisfied / not wired (flagged)

- **`shared/src/shared/nillion/nilldb.user.service.ts#getUserDelegationToken`** — a delegation-payload
  producer whose body (`{didString, surveyId, signature, poolConfig}`) does not match the backend
  `validateDelegation` contract (`userDid`/`userAddress`/`poolId`). It has **zero callers** anywhere in the
  repo (grep across shared + both FEs: definition only), i.e. it is dead code, not a live frontend
  producer. Per "flag rather than silently ship a dead validation", I did NOT wire it (wiring dead code
  adds a shared-barrel dependency for no runtime benefit). Flagged here for a follow-up decision:
  either delete it or reconcile its payload to the delegation contract.

## Files changed

- `shared/src/shared/nillcc-validation.ts` (new) — producer-side validators + `NillccValidationError`/`throwOnFailure` + payload types.
- `shared/src/shared/nillcc-validation.test.ts` (new) — per-route matrix tests (valid passes; every missing / wrong-type / partial-poolConfig field caught), 62 tests.
- `shared/src/shared/lit/keys.test.ts` (new) — usage-key caller wiring test (invalid → no fetch; valid → fetch + apiKey).
- `shared/src/shared/index.ts` — re-export `nillcc-validation.js`.
- `shared/src/shared/lit/keys.ts` — validate before `fetchLitApiKey` fetch.
- `frontend-organiser/src/controllers/new.ctrlr.ts.ts` — `guardValid(validate*)` before pools / builder/register / surveys create.
- `frontend-organiser/src/controllers/survey.ctrlr.ts` — `guardValid(validateResults)` before results (body `survey`=queryIds); `guardValid(validateSurveyUpdate)` + signature/userAddress on PUT.
- `frontend-organiser/src/controllers/new.ctrlr.test.ts` — stub validators (pass) + fail-fast test (pool create blocked, no send, error UI).
- `frontend-respondents/src/controllers/survey.ctrlr.ts` / `account-ctrlr.ts` / `completed-ctrlr.ts` — validate before delegation (submit+migrate) / score sends.
- `frontend-respondents` tests (`survey-ctrlr.test.ts`, `account-ctrlr.test.ts`, `completed-ctrlr.test.ts`) — stub validators (pass) + fail-fast test (delegation blocked, no send).

## Gates (exact vitest summary lines + build)

| Package | Test files | Tests | Build | Baseline → now |
|---|---|---|---|---|
| `@s3ntiment/shared` | 13 passed (13) | **167 passed (167)** | ✅ tsc | 11 files / 103 tests → 13 / 167 (existing 103 all still pass; +64 = 62 validator matrix + 2 usage-key wiring) |
| `@s3ntiment/frontend-organiser` | 6 passed (6) | **33 passed (33)** | ✅ vite | 6 / 32 → 6 / 33 (+1 fail-fast) |
| `frontend-respondents` | 13 passed (13) | **128 passed (128)** | ✅ vite | 13 / 127 → 13 / 128 (+1 fail-fast) |
| `@s3ntiment/nillcc-backend` | 5 passed (5) | **61 passed (61)** | ✅ tsc | unchanged (61/5, pre-#40 base) — backend source untouched |

Commands (run from the worktree root, after `pnpm install` + `pnpm --filter s3ntiment-contracts build:constants`):
```
pnpm --filter @s3ntiment/shared test && pnpm --filter @s3ntiment/shared build
pnpm --filter @s3ntiment/frontend-organiser test && pnpm --filter @s3ntiment/frontend-organiser build
pnpm --filter frontend-respondents test && pnpm --filter frontend-respondents build
pnpm --filter @s3ntiment/nillcc-backend test && pnpm --filter @s3ntiment/nillcc-backend build
```

**Note on the shared gate:** the task's "shared should stay 103/11" referred to no regression in the
existing shared suite; the validation tests the task requires necessarily live in shared (where the
validators are, so per-caller matrix coverage is collocated), which raises the shared count to 13/167.
All 103 pre-existing shared tests still pass. No new dependencies anywhere.

## Acceptance checklist
- [x] All gates green (test + build, all four packages)
- [x] No new deps
- [x] No stray files (only intended source; `dist/` gitignored)
- [x] No debug instrumentation (only existing-pattern `console.error` on validation failure)
- [x] Main checkout untouched (work is isolated in its own worktree off `origin/main`)
- [x] PR opened; NOT merged
