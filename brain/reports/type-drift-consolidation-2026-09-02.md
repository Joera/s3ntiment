# Type-drift consolidation — Pool/Survey map + entry aliases, SurveyState rename, Pool.config

**Date:** 2026-09-02
**Branch:** `deepseek/type-drift-consolidation`
**Repo:** `github.com/Joera/s3ntiment`
**Type:** implement (type-only consolidation + one runtime-honesty fix)
**Reflects commit:** `ec167421d` (branch `deepseek/type-drift-consolidation`)

## Result

Consolidated the duplicated survey/pool **map and entry aliases** onto the single
canonical declaration site (`shared/src/shared/survey/types.ts`, exported via
`@s3ntiment/shared`), deleted all local re-declarations, renamed the misleading
respondents `SurveyState` view-state, and resolved the `Pool.config` construction
drift in `getPoolInfo()`. All package gates green (exact commands + counts below).
PR opened from this branch; **not merged** (per instructions).

## What changed

1. **Canonical aliases in shared** — `shared/src/shared/survey/types.ts` now
   declares (single site across the monorepo) and exports via
   `shared/src/shared/survey/index.ts` → `shared/src/shared/index.ts`:
   `PoolsMap = Record<string, Pool>`, `SurveysMap = Record<string, Survey>`,
   `BatchesMap = Record<string, Batch>`, `SurveyEntry extends Survey { answeredQuestions: number[] }`,
   `SurveyMap = Record<string, SurveyEntry>`.

2. **Deleted duplicate locals + re-pointed to `@s3ntiment/shared`:**
   - `frontend-respondents/src/state/storage.ts` — removed local `PoolsMap`
     interface (~line 109); `PoolsMap`/`SurveyMap` now imported from shared.
   - `frontend-respondents/src/state/surveys.store.ts` — removed local
     `SurveyEntry`/`SurveyMap`; imported from shared (both still used in-file).
   - `frontend-respondents/src/state/store.ts` — re-pointed `SurveyEntry`/`SurveyMap`
     imports from `./surveys.store.js` to `@s3ntiment/shared`.
   - `frontend-organiser/src/state/types.ts` — removed local
     `SurveysMap`/`PoolsMap`/`BatchesMap`; re-exports them from shared
     (`export type { … } from "@s3ntiment/shared"`) so organiser modules can keep
     importing maps from the local types module without re-declaring.
   - `frontend-organiser/src/state/storage.ts` — imports `PoolsMap`/`BatchesMap`/
     `SurveysMap` from shared; `DraftsMap` stays local.
   - Verified repo-wide: **zero** local `interface PoolsMap/SurveysMap/BatchesMap/
     SurveyEntry` / `type SurveyMap` remain outside `shared/…/survey/types.ts`.

3. **`SurveyState` → `SurveyAnswerState`** (`frontend-respondents/src/state/store.types.ts`)
   — renamed the misleading view-state (it is NOT a Survey variant) with a comment
   explaining the trap. It had no live usages beyond its own definition (verified by
   grep), so no usage-site updates were needed; the rename makes the intent explicit.

4. **Pool.config construction drift resolved** — see decision below.

5. **Kept as-is (per brief):** `DraftMeta`/`DraftsMap`/`AppState` (organiser),
   `FlatQuestion` (respondents). Did **not** merge `SurveyQuestion` into `Question`
   (not trivially type-safe — `SurveyQuestion.type` lacks `'scored-single'` and has
   no `required`; `Question` is the canonical type, so this is a separate,
   deliberately-scoped decision, not part of this PR).

## Decision: `Pool.config` is optional; `getPoolInfo()` returns the partial config it can derive

**Context / how config is actually produced:**
- `Pool.config` (a `PoolConfig`: `safe`, `chainId`, `litNetwork`, `pkpId`, `pkpDid`,
  `groupId`) is produced in exactly **one** place in the organiser:
  `frontend-organiser/src/controllers/new.ctrlr.ts.ts` **new-pool** path, assembled
  from the backend `POST /api/pools` response (`pkpId`, `pkpDid`, `groupId`) plus
  env (`safe`, `chainId`, `litNetwork`), then `store.addPool({…, config})`.
- The **import** path (`frontend-organiser/src/controllers/overview.ctrlr.ts`
  `import-pool` event → `getPoolInfo()` in `frontend-organiser/src/factories/pool.factory.ts`)
  reads **only on-chain** data (`getPool`, `getPoolBatches`, `getOwners`) and previously
  returned a `Pool` with **no** `config` — a type lie against the then-required
  `config: PoolConfig`.
- `pool.ctrlr.ts` / `pool-list.ts` preserve whatever config the store already had.

**Is config genuinely always present on real pools?** No.
- `pkpId`/`pkpDid`/`groupId` are **minted at creation** (Lit PKP + group) and returned
  **only** to the creating organiser in the `POST /api/pools` response. They are not
  on-chain and there is no backend `GET` for pool config (`nillcc-backend/src/pool.ctrlr.ts`
  has only `create`/`update`/`registerBuilder`). So any pool imported via on-chain
  lookup — fresh device, cleared localStorage, co-organiser — **legitimately has no
  config**, with no recovery path today.
- Consumers already treat config as absent-able: `new.ctrlr.ts.ts` uses
  `store.getPool(poolId)?.config`, `survey.ctrlr.ts` uses `this.pool.config?.safe` /
  `this.pool.config!`. The backend `create()` guards loudly with `MISSING_POOL_CONFIG`
  when the create-survey payload lacks `pkpId`/`pkpDid`/`safe` — i.e. the enforcement
  point is the survey-creation seam, not the type.

**Decision:** relax canonical `Pool.config` to **optional** (`config?: PoolConfig`) —
the type must not claim a field that legitimate pools provably lack. This is the
honest fix, and it is what future backend validation schemas should build on: a
`Pool` may carry a full config (organiser-created) or a partial/absent one (imported);
the create-survey path must keep validating `poolConfig.pkpId/pkpDid/safe` at the
backend guard.

**Complementary change:** `getPoolInfo()` now populates the config fields it **can**
derive at import time — `safe` (on-chain), `chainId`/`litNetwork` (env, mirroring the
create path) — so imported pools immediately carry their Safe + network identity
(which `survey.ctrlr.ts` needs for `connectToExistingSafe(config.safe)`), while
remaining honest about the unrecoverable PKP/group identity.

**Rejected alternative:** keeping `config: PoolConfig` required and forcing
`getPoolInfo()` to fabricate a full config would make the type a lie (a `Pool` with a
`config` that cannot actually decrypt/delegate), turning a real missing-config state
into silent downstream breakage.

## Gates (exact commands + collected counts, run in isolated worktree)

Built/tests run at the fix commit from `/home/joera/code/worktrees/s3ntiment/type-drift-consolidation`
(worktree of `main`, branch `deepseek/type-drift-consolidation`). Counts taken from
`vitest run` summary lines (not grep).

| Package | typecheck/build command | result | test command | result |
|---|---|---|---|---|
| `@s3ntiment/shared` | `pnpm --filter @s3ntiment/shared build` (tsc) | exit 0 | `pnpm --filter @s3ntiment/shared test` (`vitest run`) | **103 passed (11 files)** |
| `@s3ntiment/frontend-organiser` | `pnpm --filter @s3ntiment/frontend-organiser build` (vite build) | exit 0 (pre-existing chunk-size warning only) | `pnpm --filter @s3ntiment/frontend-organiser test` (`vitest run`) | **32 passed (6 files)** |
| `frontend-respondents` | `pnpm --filter frontend-respondents build` (vite build) | exit 0 (pre-existing chunk-size warning only) | `pnpm --filter frontend-respondents test` (`vitest run`) | **127 passed (13 files)** |
| `@s3ntiment/nillcc-backend` (must still pass — imports shared types) | `pnpm --filter @s3ntiment/nillcc-backend build` (tsc) | exit 0 | `pnpm --filter @s3ntiment/nillcc-backend test` (`vitest run`) | **29 passed (4 files)** |

All counts match the pre-change baselines recorded in `brain/reviews/survey-config-pr37-review-2026-09-02.md`
(shared 103, organiser 32, backend 29) — the consolidation introduced no behavioural
change and no test churn.

**Supplementary (not a package gate, for diligence):** `tsc --noEmit` over the
respondents tsconfig surfaces only **pre-existing** errors also present on `main`
(stale `store.types.ts` → `../controllers/landing.ctrlr.js` import; `SurveyEntry`
`config` destructure in `surveys.store.ts.persist()` against the shared `Survey`
shape; viem dual-type duplication in the pnpm store). None are introduced by this PR;
the respondents package has no `tsc` script — its own build gate is `vite build`,
which is green. The organiser has no `tsconfig.json` (vite build is its gate).

## Notes

- `shared/src/shared/survey/types.ts` remains the **only** declaration site for
  `Pool`, `PoolConfig`, `Survey`, `EncryptedConfig`, `QuestionGroup`, `Question`,
  `Batch` and now also the map/entry aliases.
- SPEC-shared.md already documents `Pool` embedding `config: PoolConfig`; this PR
  amends that to "`config` optional (imported pools may lack it)". Consider a small
  SPEC note on merge.
- PR: **not merged** — opened for review per instructions.
