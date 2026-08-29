# shared unit-test tranche — 2026-08-28 (Bucket 1.1)

**Branch:** `deepseek/shared-unit-tests`
**Base:** `main` at `b5e622671`
**PR scope:** add a dedicated vitest unit suite for the `@s3ntiment/shared` pure
logic. No production source in `shared/` or any other package was touched.

## What was added

| Item | Path |
|---|---|
| vitest devDependency (`^4.1.11`) + `"test": "vitest run"` script | `shared/package.json` |
| vitest config (node env, mirrors frontend-respondents / organiser) | `shared/vitest.config.ts` |
| 9 leaf unit suites (below) + lockfile update | `pnpm-lock.yaml` |

Import discipline (per the acceptance contract): every test imports its leaf
module by **direct relative source path**, never the `@s3ntiment/shared` barrel —
the barrel re-exports Lit/Nillion/d3 that do not load in a plain node env. The
type-only `../index.js` / `@s3ntiment/shared` imports inside some leaves are
elided by the esbuild transform, so nothing pulls the heavy dependency graph in
(verified empirically with a smoke test before writing the suite).

## Test files & case counts

| Test file | Leaf module(s) under test | `it()` cases |
|---|---|---|
| `shared/src/shared/results/scoring.factory.test.ts` | `isScored`, `stripScoring`, `calculateScore` (pct rounding, `max==0` guard) | 19 |
| `shared/src/shared/results/tabulate.test.ts` | `tallyResults` (text/radio/scale/checkbox/scored-single + scoringMap lookup) | 10 |
| `shared/src/shared/survey/tally.test.ts` | `combineShares` (skips non-arrays, skips `_id`) | 6 |
| `shared/src/shared/survey/response.factory.test.ts` | `prepareAnswers`, `createUserDataObject` (one-hot `%allot`, `ensureAllot`) | 15 |
| `shared/src/shared/survey/collection.factory.test.ts` | `createSurveyCollectionSchema` (per-type schema, name fallback) | 10 |
| `shared/src/shared/survey/queries.test.ts` | `createSurveyAggregationQuery` (scale/radio/checkbox stages, uuid) | 7 |
| `shared/src/shared/nillion/did.test.ts` | `publicKeyToDidKey` (compressed-ECDSA prefix parity, base58, `0x` strip) | 7 |
| `shared/src/shared/helpers/retries.test.ts` | `withRetry` (success/failure/backoff/AbortError→timeout) | 6 |
| `shared/src/shared/helpers/timeout.test.ts` | `callWithTimeout` (value/error/signal/abort) | 6 |
| **Total** | | **86** |

## Notes on behaviour pinned (worth flagging to reviewers)

- `scoring.factory.calculateScore` compares `userData[questionId]` to the **option
  text** at `options[correctAnswer]`; `stripScoring` leaves `safeConfigWithScoring.groups`
  as the same reference as the input (scoring still attached) while `safeConfig.groups`
  has the `scoring` sibling removed.
- `response.factory`: `prepareAnswers` stringifies answers *before*
  `createUserDataObject` sees them, so `ensureAllot`'s object-`%allot` branch is
  effectively unreachable through the public path and its wrapper-`%allot` values
  are `Number(...)`; tests pin the actually-reachable behaviour (e.g. a
  non-numeric scored-single string yields `%allot: NaN`, so a parseable numeric
  string is used for a deterministic assertion).
- `nillion/did.ts` compresses `04`-uncompressed keys to `02`/`03` by y-parity; the
  expected `did:key:z…` strings are pinned regression canaries computed from the
  real algorithm (base58btc of `[0xe7,0x01] || pubkey`).
- `tabulate` scale average uses `toFixed(2)` on summed ints and returns literal `0`
  (not `"0.00"`) when no numeric responses exist.

## GREEN GATES (all verified before opening PR)

| # | Command | Result |
|---|---|---|
| 1 | `cd shared && pnpm vitest run` (via added `test` script) | **86/86 passed (9 files)** |
| 2 | `pnpm --filter @s3ntiment/shared build` | **green** (tsc, no export/type breakage) |
| 3 | `cd contracts && pnpm hardhat test` | **36/36 passing** (consumes built shared dist, still satisfied) |
| 4 | `cd frontend-respondents && pnpm vitest run` | **107/107 passing** (imports shared by relative source path, unaffected) |

`shared/` is built by bare `tsc` (its `tsconfig.json` includes `src/shared/**/*`),
so the colocated `.test.ts` files are type-checked by the build — the suite is
kept type-clean (`npx tsc --noEmit` → 0 errors) and `shared/dist` is gitignored.
No production source and no other package were modified.
