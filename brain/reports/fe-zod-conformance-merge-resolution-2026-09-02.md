# Report — PR #42 merge-resolution: zod conformance onto #41 hand-rolled validation

**Date:** 2026-09-02
**PR:** #42 `deepseek/fe-zod-conformance` → `main`
**Worktree:** `~/code/worktrees/s3ntiment/fe-zod-conformance` (isolated, seeded from `7cf18fb93`)
**Merged:** `origin/main` = PR #41 (`1338feebc`, deepseek/fe-validation) into the PR branch
**Status:** RESOLVED — mergeable=TRUE, all gates green, pushed.

## Context: two parallel producer-validation approaches

- **PR #41 (main):** HAND-ROLLED producer validation — `shared/src/shared/nillcc-validation.ts`
  (`validateBody` + per-route validators returning `ValidationFailure|null` + `throwOnFailure`),
  exported from the shared barrel, wired via `guardValid(...)` into the organiser controllers
  (`new.ctrlr.ts.ts`, `survey.ctrlr.ts`) **and** into the frontend-respondents controllers
  (`account-ctrlr.ts`, `completed-ctrlr.ts`, `survey-ctrlr.ts`) and `shared/src/shared/lit/keys.ts`.
- **PR #42 (branch):** ZOD-canonical schemas (`shared/src/shared/nillcc/{inputs,outputs}.ts` +
  tests), `@s3ntiment/shared/nillcc` subpath export, `nillcc-backend` `validation.ts` refactor +
  `conformance.test.ts` pinning backend `requiredFieldPaths` == shared zod field paths for all 8
  routes, organiser FE payload builders (`nillcc-payloads.ts`) + `validateXxxInput/Output` wired at
  all 5 organiser fetch sites, plus two payload-bug fixes (results `queryIds`→`survey` array, update
  reshaped to `{survey,poolConfig,surveyConfig:{id}}`).

## What conflicted (3 content conflicts; verified by merge dry-run)

1. `frontend-organiser/src/controllers/new.ctrlr.ts.ts` — both PRs added a validation seam at the
   same 3 fetch sites (pool create, builder register, survey create).
2. `frontend-organiser/src/controllers/survey.ctrlr.ts` — same at results + survey-update sites.
3. `shared/src/shared/index.ts` — both added an export line.
4. `pnpm-lock.yaml` — **auto-merged cleanly** (zod only on #42's side; #41 added no deps).

## How each was resolved

- **1 & 2 (organiser controllers):** took **#42's ZOD wiring as canonical** — `git checkout --ours`
  on both files (i.e. the PR-branch version, byte-identical to `7cf18fb93`). The
  `buildXxxPayload + validateXxxInput/validateXxxOutput` seam **replaces** the #41
  `guardValid(validate*)` seam at the same fetch sites. Result imports from
  `@s3ntiment/shared/nillcc` (zod), not the hand-rolled `nillcc-validation` fns. The #41 `guardValid`
  helper is gone from the organiser controllers (nothing references it). #41's other changes to these
  files were solely the hand-rolled seam, so `--ours` loses nothing.
- **3 (shared barrel):** kept **BOTH** exports — `export * from './nillcc/index.js'` (#42, used by
  organiser) **and** `export * from './nillcc-validation.js'` (#41, still used by frontend-respondents
  + `lit/keys.ts`). `nillcc-validation.ts` NOT deleted (respondents migration is out of scope).

## Auto-merge surprise (caught, fixed)

`frontend-organiser/src/controllers/new.ctrlr.test.ts` auto-merged from #41's version, whose third
test mocked the hand-rolled `validatePoolCreate` (returns `{error,message}` → `guardValid`) and
asserted fail-fast-before-fetch. With the zod-wired controller that mock is dead (the controller
never calls the barrel validator), so the test would fail. Fixed to match the canonical zod seam:
the barrel mock is reduced to a stub, `@s3ntiment/shared/nillcc` is kept **real** via
`importOriginal` (only `validatePoolCreateInput` overridable), and the fail-fast test now forces
`validatePoolCreateInput` to throw and asserts the fetch never fires. The two payload-contract tests
still run against the real zod schemas. The zod fail-fast-at-builder level remains covered by
`nillcc-payloads.test.ts`.

## Intactness checks

- Both payload-bug fixes intact: `buildResultsPayload` maps `queryIds` → wire `survey` array;
  `buildSurveyUpdatePayload` reshapes to `{survey, poolConfig, surveyConfig:{id}}`.
- `nillcc-backend` keeps #42's `validation.ts` refactor + `conformance.test.ts`; backend remains
  **zero-dep** (no zod in `nillcc-backend/package.json`; zod only via `@s3ntiment/shared`, used in
  test/type positions only).
- `shared/package.json` keeps zod `^3.24.1`; `@s3ntiment/shared/nillcc` subpath export intact.
- frontend-respondents untouched by this merge-resolution (stays on the merged hand-rolled path).

## Final gate counts (order as required)

| Gate | Result |
|---|---|
| `pnpm --filter @s3ntiment/shared build` (FIRST) | ✅ exit 0 (tsc) |
| `pnpm --filter @s3ntiment/frontend-organiser test` | ✅ 7 files / **48 tests** |
| `pnpm --filter @s3ntiment/frontend-organiser build` | ✅ exit 0 (vite build) |
| `pnpm --filter @s3ntiment/shared test` | ✅ 15 files / **247 tests** |
| `pnpm --filter @s3ntiment/shared build` | ✅ exit 0 |
| `pnpm --filter @s3ntiment/nillcc-backend test` | ✅ 6 files / **69 tests** (incl. `conformance.test.ts` 8 tests — one per route, pinning backend `requiredFieldPaths` == shared zod paths) |
| `pnpm --filter @s3ntiment/nillcc-backend build` | ✅ exit 0 (tsc) |
| `pnpm install --frozen-lockfile` | ✅ exit 0 |

**Total: 364 tests green across shared + organiser + backend.**

## Follow-ups noticed

- **Validator drift (expected):** respondents remain on the hand-rolled `nillcc-validation.ts` while
  the organiser uses the zod `nillcc/index.ts` schemas — two mirrors of the same backend contract
  that can drift. The backend conformance test pins zod↔backend but **not** `nillcc-validation.ts`↔
  zod. Recommended follow-up: migrate frontend-respondents + `lit/keys.ts` to `@s3ntiment/shared/nillcc`
  zod (a separate PR), then delete `nillcc-validation.ts` + its test.
- `new.ctrlr.test.ts`'s fail-fast coverage is now via a forced-throw override of
  `validatePoolCreateInput` rather than a real malformed payload (the builder always produces valid
  payloads); the real throw paths are covered at the schema level by `nillcc-payloads.test.ts`.
