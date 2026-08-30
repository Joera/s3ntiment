# Per-network typed constants helper for S3ntimentSurveyStore

**Date:** 2026-08-30
**Branch:** `deepseek/constants-helper`
**Repo:** `github.com/Joera/s3ntiment`
**Type:** implement (code-only; no deploy / no on-chain tx)
**Reflects commit:** `88339d6` (branch `deepseek/constants-helper`)

## Result
Added a thin, typed, per-network constants module in the contracts package
(`contracts/src/constants.ts`) exposing `S3NTIMENT_STORE = { address, abi, chainId }`
for Base, with `address` + `abi` **derived** from the committed hardhat-deploy
artifact `contracts/deployments/base/S3ntimentSurveyStore.json` (single source of
truth — no duplicated `0x…` literal). Also exposes a `S3NTIMENT_STORE_BY_NETWORK`
registry (`{ base }`) so other networks (e.g. a future Sepolia deploy) extend it
trivially.

## What changed
- `contracts/src/constants.ts` — new helper. Imports the deployment JSON; casts
  `address` to `0x${string}`; carries `abi` by reference to the JSON; `chainId: 8453`.
- `contracts/package.json` — added export `"./constants"` → `./dist/constants.js` 
  (mirrors the existing `./deployments/*` / `./src/*` export style). No new deps.
- Consumers (best-effort, low-risk refactor, **no functional change**):
  - `frontend-organiser` — `factories/{survey,pool}.factory.ts`, `factories/survey.factory.test.ts`,
    `controllers/{survey,pool,batch,new.ctrlr}.ts(.ts)`
  - `frontend-respondents` — `router.ts`, `humanWallet.factory.ts` + `.test.ts`,
    `controllers/{auth,survey,used-card}-ctrlr.ts`
  - `nillcc-backend` — `main.ts`, `contract.factory.ts`, `pool.ctrlr.ts`, `survey.ctrlr.ts`
  - Each previously imported the raw JSON path
    `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json`; now imports
    `s3ntiment-contracts/constants`, aliased `S3NTIMENT_STORE as surveyStore`, so
    every existing `surveyStore.address` / `surveyStore.abi` usage is byte-identical
    behavior.
- `shared` (`@s3ntiment/shared`) is **unchanged and stays decoupled** — no cycle
  (`shared` does not depend on `s3ntiment-contracts`; the helper lives in the
  contracts package exactly the direction the dependency graph allows).

## Design choice
Option (a) from the deploy-pipeline report §4 / the task: helper exported from the
contracts package itself, consistent with it already exporting `./deployments/*`.
Not in `shared` (avoids the dependency cycle). Not duplicated per-app (single named
source of truth).

## Gates
- `nillcc-backend` `tsc --noEmit` (NodeNext) — **PASS**
- `frontend-organiser` `vite build` — **PASS**
- `frontend-respondents` `vite build` — **PASS**
- Tests (`vitest run`):
  - `nillcc-backend`: 35/35 PASS
  - `frontend-organiser`: 28/28 PASS
  - `frontend-respondents`: 113/113 PASS
- `pnpm check:abi` (contracts) — **GREEN** in this worktree after a fresh
  `hardhat compile` (deployment ABI matches compiled artifact + typed ABI, 34
  entries). The pre-existing stale/hand-edited divergence documented in the
  findings report §5 did **not** reproduce on this checkout; regardless, this
  task touches only the helper + consumer imports and does not modify the
  deployment payload or perform any redeploy/verification/on-chain tx.

## PR
Title: `feat(contracts): per-network constants helper for S3ntimentSurveyStore`
PR URL: `https://github.com/Joera/s3ntiment/pull/23`

## Notes / caveats
- No live deploy, verification, or on-chain transaction was performed (code-only).
- `nillcc-backend` runs in dev via `tsx` and builds via `tsc`; its production
  `start` (`node dist/main.js`) already relies on package resolution that this
  change does not alter for the JSON import, and the new helper is likewise
  resolved through `s3ntiment-contracts` exports (`./constants` → `./dist/constants.js`,
  compiled for plain-node production — see B1 fix below).

---

## B1 fix (2026-08-30) — resolve `./constants` to a compiled, node-loadable artifact

### Problem (reviewer B1, blocking)
The new `s3ntiment-contracts/constants` export pointed at **raw source**
`contracts/src/constants.ts`. `nillcc-backend` production start is
`node dist/main.js`; Node's ESM loader cannot execute a `.ts` file
('Unknown file extension .ts'), so `import 's3ntiment-contracts/constants'`
failed at runtime on the packaged path. The gates (`tsc --noEmit`, `vitest`,
`tsx`) all transpile `.ts`, so they masked the regression — only a plain-`node`
run exposes it. This is now fixed and gated.

### What changed
- `contracts/tsconfig.constants.json` (new) — standalone build of just
  `src/constants.ts` with `rootDir: "src"`, `outDir: "dist"`, `module/moduleResolution:
  nodenext`, `resolveJsonModule: true`. Because `rootDir` is `src`, the helper emits
  to **`dist/constants.js`** (not `dist/src/...`), so its preserved relative import
  `../deployments/base/S3ntimentSurveyStore.json` resolves to the committed JSON at
  `contracts/deployments/...` at runtime. The `with { type: 'json' }` import attribute
  survives compilation exactly, so a plain Node ESM loader resolves the deployment
  JSON the same way the previous committed-JSON import did.
- `contracts/package.json`:
  - export `"./constants"` now maps
    `{ types: "./dist/constants.d.ts", import: "./dist/constants.js" }` — a compiled
    artifact, mirroring how `@s3ntiment/shared` publishes `dist`. (`files` already
    included `dist`, and `dist` is gitignored via the root `**/dist`.)
  - added scripts `build:constants` (`tsc -p tsconfig.constants.json`) and, wired
    into the package build, `typescript` is now `tsc && tsc -p tsconfig.constants.json`
    so building contracts always emits `dist/constants.js`.
  - added **gate** `check:constants` = `pnpm build:constants && node scripts/check-constants.mjs`.
- `contracts/scripts/check-constants.mjs` (new) — boots plain **node** and resolves
  `s3ntiment-contracts/constants` (Node self-reference read through the same
  `exports` map the backend hits via its `file:../contracts` link). It asserts the
  resolved URL is `.../dist/constants.js` (not raw `src`), that
  `S3NTIMENT_STORE.address` equals the deployment JSON address, the ABI is non-empty
  and length-matches, `chainId === 8453`, and the registry `base` addresses line up.

No hardcoded `0x…` anywhere; `shared` stays decoupled; no new cycle; all consumer
imports remain `S3NTIMENT_STORE as surveyStore` — behavior-preserving.

### Gates (B1 fix)
- `pnpm --filter s3ntiment-contracts check:constants` — **PASS**
  (`resolved …/contracts/dist/constants.js`; address/abi/chainId/registry verified).
- Plain-node probe from `nillcc-backend/node_modules/s3ntiment-contracts` (the exact
  prod link): `node -e "import('s3ntiment-contracts/constants')"` → resolves to
  `contracts/dist/constants.js`, address `0x11a1…2354`, abi 34 — **PASS** (this is the
  resolution invoked by `node dist/main.js` on the `.ts`→`.js` switch).
- `nillcc-backend` `tsc --noEmit` — **PASS**; `pnpm --filter @s3ntiment/nillcc-backend build`
  (`tsc`) emits `dist/main.js` — **PASS**.
- Not re-run: `pnpm check:abi` (contracts). Its only known failure mode is the
  PRE-EXISTING stale/hand-edited deployment divergence documented in
  `brain/reports/deploy-pipeline-2026-08-30.md` §5 — not a regression of this PR;
  no live deploy/verify was performed and no funds spent.

### Commit
- `fix(contracts): compile ./constants to dist and gate node resolution (B1)`
