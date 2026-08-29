# Respondent Stores + Controllers Test Tranche — report

**Date:** 2026-08-28
**Scope:** `@s3ntiment/frontend-respondents` test-only tranche (node env, no jsdom).
**Branch:** `deepseek/respondent-stores-ctrlrs-tests`
**Base:** `main` @ `f23d0dfd3` (Merge PR #9 — latest main at branch cut).
**Mode:** implement (test-only). No production source modified.

## What was added (3 files, +35 `it()` tests → 84 total, up from 49)

| # | Test file | New tests | What it covers |
|---|-----------|-----------|----------------|
| 1 | `src/state/stores.test.ts` | 29 | **State-store unit tranche** (the §3 state gaps from the exploration report): `Observable` subscribe/notify/unsubscribe semantics; `storage.slugify` edge cases; `PoolStore.add/remove/set/get` incl. dedupe-by-id, persistence-to-storage, unknown-id no-op; `UserStore.set/persist/clear` incl. empty-update no-op and storage round-trips; `SurveysStore.clear(surveyId)` per-id vs full clear. |
| 2 | `src/controllers/used-card-ctrlr.test.ts` | 5 | **"Sign in" flow branches** (exploration §4 borderline gap): `authenticate()` true → `router.navigate('/surveys/:id')`; `authenticate()` false → `alert('You did not register…')` + no nav; rejects → propagates (no nav, no alert — honest match of source, which does not try/catch); template wiring + button listener; `destroy()`. |
| 3 | `src/controllers/survey-ctrlr.test.ts` (+1) | 1 | **Cold-start regression, R1 pool-config gap pinned** (exploration §5 CONFIRMED gap). A fresh controller with **un-seeded** `poolConfig` + store primed with a pool: the shared fetch derefs `poolConfig.pkpId` (replicated in the mock) → throws → lands in `renderWarning`, does **not** navigate, does **not** reach `renderTemplate` (no `survey-questions`, no `survey-complete` listener). Intentionally does **not** pre-seed poolConfig and does **not** fix the gap (deferred to live-env; documented in SPEC Gaps). |

## Approach / decisions

- **Real stores, minimal stubbing.** Store tests instantiate the real `PoolStore`/`UserStore`/`SurveysStore`/`Observable` over the `test/setup.ts` in-memory `localStorage` stub; persistence round-trips are asserted against `load*FromStorage`. No `vi.mock` on the stores → no vacuous passes.
- **used-card-ctrlr** mocks only `@s3ntiment/shared/components` (top-level custom-element side effect), `../router.js`, and `../auth.factory.js` — the same pattern as `auth-ctrlr.test.ts`; the real `store` is used for the UI view bind. `viem/chains` and the JSON deployment import load natively in node.
- **Honest branch matching:** the `authenticate()`-rejects case is asserted to *propagate* and do neither nav nor alert, because the source does not try/catch `authenticate`. This matches the source (acceptance: "match source behavior") rather than the scope's shorthand "rejects → alert".
- **No network / live chain / DOM lib.** Everything runs in the existing node env + `test/setup.ts` globals.

## Gates (exact commands + counts)

```
$ pnpm --filter frontend-respondents test        # vitest run
  Test Files  9 passed (9)
       Tests  84 passed (84)                     # +35 over the prior 49

$ pnpm build                                     # in frontend-respondents
  ✓ 6980 modules transformed … ✓ built in 42.38s
```

### Gate-command note (package-name discrepancy)
The dispatch prompt's gate command used the filter **`@s3ntiment/frontend-respondents`**, but the package's
actual `package.json` `name` is **`frontend-respondents`** (a pre-existing naming inconsistency vs
`siblings @s3ntiment/shared`, `@s3ntiment/frontend-organiser`, `@s3ntiment/nillcc-backend`). The
`@s3ntiment/…` filter matches **no project** and errors (`No projects matched the filters`). The
working equivalent is `pnpm --filter frontend-respondents test` (same `vitest run`), which is what was
executed and is reported above. I did **not** rename the package (that would touch production
`package.json` + `pnpm-lock.yaml` and is out of scope for a test-only tranche); flag for a follow-up.

## Commit
Single commit on `deepseek/respondent-stores-ctrlrs-tests` (sha below in PR body): three test files only.

## Test-file breakdown (84 total)
- auth.factory.test.ts 9 · card-class.seam.test.ts 11 · card-signature.seam.test.ts 5 ·
  card-url.round-trip.test.ts 3 · auth-ctrlr.test.ts 5 · survey-ctrlr.test.ts **8** ·
  router-entry-gates.test.ts 9 · **used-card-ctrlr.test.ts 5** · **stores.test.ts 29**
