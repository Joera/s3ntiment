# Reviewer verdict — B1 fix delta, PR #23 (deepseek/constants-helper)

**Date:** 2026-08-30
**PR:** #23 (`deepseek/constants-helper`)
**Delta reviewed:** `/tmp/constants-helper-b1fix.diff` (88339d66a → b6a8d1690
`fix(contracts): compile ./constants to dist and gate node resolution (B1)`)
**Scope:** re-review of blocking issue B1 only. Verdict: **APPROVE** (ready for human merge).

---

## 1. B1 genuinely resolved — PASS

- **Export now points at a compiled, node-loadable artifact.** `"./constants"` maps to
  `{ types: "./dist/constants.d.ts", import: "./dist/constants.js" }` — not raw
  `src/constants.ts`. This mirrors the package's other dist-based exports
  (`./artifacts/*`, `./abis/*`, `./deploy/*`, `./rocketh/*`) and how `@s3ntiment/shared`
  publishes `dist`.
- **Compilation is correct.** `tsconfig.constants.json` (`module`/`moduleResolution:
  nodenext`, `resolveJsonModule: true`, `rootDir: src`, `outDir: dist`) emits
  `dist/constants.js`. `rootDir: src` is the critical detail — it places the artifact at
  `dist/constants.js` (not `dist/src/...`), so the preserved relative import
  `../deployments/base/S3ntimentSurveyStore.json` resolves back to the committed
  `contracts/deployments/...` JSON at runtime.
- **`with { type: 'json' }` survives compilation.** I compiled `src/constants.ts` in an
  isolated /tmp copy (with the real `"type": "module"` package context) and confirmed the
  emitted ESM is:
  `import surveyStoreBase from '../deployments/base/S3ntimentSurveyStore.json' with { type: 'json' };`
  — no `require`, no CJS interop. Plain `node v22` loads `dist/constants.js` and returns
  correct values: `address=0x11a1…2354`, `abi.length=34`, `chainId=8453`. This is the
  exact resolution `node dist/main.js` performs.

## 2. The gate exercises the packaged path and would RED on a raw-.ts regression — PASS

- `check:constants` = `pnpm build:constants && node scripts/check-constants.mjs` — it
  builds first, then boots **plain `node`** (no tsx/vitest/tsc transpile masking).
- It resolves the export via Node **self-reference** (`import.meta.resolve(
  's3ntiment-contracts/constants')`) — the same exports map the backend's
  `file:../contracts` link hits. I confirmed this self-reference resolves to
  `file://…/dist/constants.js` and `endsWith('/dist/constants.js')` passes.
- If `./constants` were reverted to `./src/constants.ts`, the resolved URL would end in
  `…/src/constants.ts` and the gate **throws** — so it would RED. It is not masked by
  tsc/vitest/tsx.
- It additionally asserts the values still derive from the committed JSON
  (`S3NTIMENT_STORE.address === deployment.address`, `abi.length` match, `chainId ===
  8453`, registry `base` address) — locking derivation against future drift.

## 3. No NEW issues introduced — PASS

- **Conditional export shape** is `{ types, import }` with no `require`/`default`
  condition. All 17 consumers are ESM `import` statements across the three `type: module`
  apps (`frontend-organiser`, `frontend-respondents`, `nillcc-backend`); `git grep` at the
  head shows **zero** CJS `require()` of the package/constants. No real CJS consumer, so
  the shape is fine.
- **`dist` is in the published `files` list** (`files: ["dist","src","deployments"]`),
  so `dist/constants.js` + `.d.ts` ship.

## 4. No regression to previously-verified properties — PASS

- Helper still derives entirely from the deployment JSON (`address`/`abi` read from the
  import, no hardcoded `0x…` — confirmed in source); `chainId: 8453` unchanged.
- `@s3ntiment/shared` stays decoupled (`dependencies` empty of s3ntiment-contracts); no
  cycle.
- All 17 consumer swaps remain `S3NTIMENT_STORE as surveyStore`, mechanical and
  behavior-preserving (unchanged in this delta).

---

## Non-blocking nits / notes

- **Build-ordering (operational):** `dist/constants.js` must be produced (via
  `build:constants`, wired into the package `typescript = "tsc && tsc -p
  tsconfig.constants.json"`) before the backend's `node dist/main.js` runs, since `dist`
  is gitignored and only exists after the contracts build. This is the same convention as
  the package's other dist exports (`artifacts`, `abis`, …), so it is consistent — just
  ensure the deploy/CI pipeline builds `s3ntiment-contracts` before packaging the backend.
  Not a blocker.
- The gate's value assertions hardcode `chainId === 8453` / non-empty ABI as invariants —
  appropriate for the single-network state.
- The delta also carries a documentation update to
  `brain/reports/constants-helper-2026-08-30.md` (adds a "B1 fix" section recording the
  problem and checks) — informational, no functional impact.
- I could not run the live `pnpm check:constants` in the implementer's worktree (review
  is read-only; `main` is checked out, not the PR branch), so I re-verified by compiling
  `src/constants.ts` with the repo's own `tsc` in an isolated /tmp copy and loading the
  emitted `dist/constants.js`+JSON attribute under plain `node v22` — both confirmed the
  B1-fix behavior end to end.

## Conclusion

**APPROVE.** B1 is resolved: `s3ntiment-contracts/constants` resolves to a compiled,
plain-node-loadable ESM artifact, the `with { type: 'json' }` import survives
compilation and still resolves the deployment JSON at runtime, and the new
`check:constants` gate boots plain node against the packaged path so it REDs on a
raw-`.ts` regression. No new issues; all previously-approved properties intact. Ready for
human merge.
