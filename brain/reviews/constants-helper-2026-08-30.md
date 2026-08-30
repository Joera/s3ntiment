# Reviewer verdict — Per-network constants helper for S3ntimentSurveyStore

**Date:** 2026-08-30
**PR:** #23 (`deepseek/constants-helper`)
**Diff reviewed:** `/tmp/constants-helper-pr23.diff` (origin main...PR#23 head)
**Verdict:** REQUEST CHANGES

---

## Verified against the acceptance contract

1. **Named helper, derived from deployment JSON — PASS.**
   `contracts/src/constants.ts` imports the artifact
   `../deployments/base/S3ntimentSurveyStore.json` as its single source of truth.
   `address` and `abi` are taken from that import (`surveyStoreBase.address` /
   `surveyStoreBase.abi`); **no hardcoded `0x…` literal** anywhere in the helper or
   in the consumer swaps (confirmed by reading the diff — the `0x…` string appears
   only in the committed deployment JSON, never in `constants.ts`). `chainId: 8453`
   is correct for Base. The `as 0x${string}` cast on `address` is a runtime no-op.

2. **Consumer swaps are mechanical and behavior-preserving — PASS (with one caveat).**
   - Every consumer only ever reads `surveyStore.address` and `surveyStore.abi`
     (grep across all three apps: 26× `.address`, 18× `.abi`). The named export
     `S3NTIMENT_STORE` exposes exactly those two (plus `chainId`), aliased as
     `surveyStore`, so every usage is byte-identical.
   - Runtime values are identical: `abi` is the same object reference; `address` is
     the same string (cast is type-level only). The type of `address` narrows from
     `string` (raw JSON) to `0x${string}` — a tightening, not a change; `abi` keeps
     the same `typeof surveyStoreBase['abi']` type as the old JSON import.
   - All 17 consumer files that previously imported the raw JSON path are migrated
     (frontend-organiser: batch/new/pool/survey ctrlrs + pool.factory +
     survey.factory + survey.factory.test; frontend-respondents: router +
     humanWallet.factory + its test + auth/survey/used-card ctrlrs; nillcc-backend:
     main + contract.factory + pool.ctrlr + survey.ctrlr). No raw-JSON importer was
     left behind in these three apps.
   - **Caveat → see blocking issue (1):** the *runtime resolution* for the
     nillcc-backend production path is not a strict no-op.

3. **`shared` stays decoupled — PASS.** `@s3ntiment/shared` has **no** `dependencies`
   and no import of `s3ntiment-contracts`; `contracts/src/constants.ts` imports only
   the deployment JSON. No reverse dependency, no cycle. (`s3ntiment-contracts`
   already depends on `@s3ntiment/shared`; the helper does not reintroduce it.)

4. **Helper lives in the contracts package — PASS.** Correct direction per the
   dependency graph, not in `shared`.

5. **`package.json` export consistency — PASS (minor note).** The added
   `"./constants": "./src/constants.ts"` mirrors the existing `"./src/*": "./src/*"`
   export style (raw `.ts` target), and `src` is in the published `files` list,
   alongside `deployments` (so the JSON stays reachable too). The only nit: it is the
   one non-wildcard export, and it points at *source* `.ts` rather than a compiled
   artifact — see blocking issue (1) for why that matters on the backend's prod path.

6. **Registry / network typing — PASS.** `S3NTIMENT_STORE_BY_NETWORK = { base:
   S3NTIMENT_STORE } as const` and `S3ntimentNetwork = keyof ...` give `'base'`.
   Typing is sane (`abi` literal type, `address` `0x${string}`). Minor nit: because
   `S3NTIMENT_STORE` is declared `: S3ntimentSurveyStoreConstant`, `as const` on the
   registry does not narrow `chainId` to the literal `8453` (stays `number`); harmless
   today, worth a `8453 as const` if literal typing is ever relied on.

## Blocking issues

- **B1 — nillcc-backend production runtime regression (functional change vs. the
  contract's "no functional change").**
  The old import
  `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` resolved to a
  committed `.json` that any Node runtime loads directly. The new
  `s3ntiment-contracts/constants` export maps to **raw source
  `contracts/src/constants.ts`** (it ignores the package's compiled `dist`). The
  backend's `start` is `node dist/main.js`; Node's ESM loader cannot execute a `.ts`
  file ("Unknown file extension .ts"), so this import will fail at runtime on the
  packaged path — a path the gates do **not** cover (`tsc --noEmit` only type-checks,
  and `vitest`/`tsx` transpile `.ts`, so they mask the issue). The implementer's
  report caveat claims the production `start` path is "not altered" by the change —
  that is inaccurate: the resolution target changes from node-loadable JSON to
  node-unloadable TS.
  **Fix:** export from a compiled artifact (e.g. point `./constants` at
  `./dist/constants.js` produced by the contracts `tsc` build, mirroring how
  `@s3ntiment/shared` publishes `dist`), or boot the backend via a TS-aware loader;
  and add a gate that actually resolves/boots `node dist/main.js` (or at minimum an
  exports-resolution check) rather than only `tsc`/`vitest`.

## Non-blocking nits

- No direct test of the helper itself; consider one asserting
  `S3NTIMENT_STORE.address` equals the deployment JSON's address and `abi.length`
  matches, to lock the derivation against future edits.
- `chainId` widens to `number` in the `as const` registry (see item 6).
- `new.ctrlr.ts.ts` has a pre-existing doubled `.ts.ts` extension — untouched by this
  PR, not introduced here; no action needed unless desired.
- The `./constants` export being non-wildcard is fine but slightly off the `/*`
  pattern of its siblings.

## Conclusion

The change is clean, well-scoped, correctly derived from the single source of truth,
keeps `shared` decoupled, and its data-level behavior is identical. It is **not** a
strict no-op on the nillcc-backend packaged runtime path (blocking issue B1), which
the gates do not exercise. Fix B1 (and add the corresponding gate), and this is
approve-ready.
