# Fix: respondent delegation 502 (uncaught Lit 403) — FIX A / B / C

**Date:** 2026-09-03
**Branch:** `fix/delegation-502-lit-403`
**Repo:** `github.com/Joera/s3ntiment`
**Type:** implement (backend + shared source; no deploy / no on-chain tx)
**Reflects commit:** `(see git log on branch fix/delegation-502-lit-403)`
**Audit:** `brain/audits/survey-delegation-502-lit-403-2026-09-03.md` (committed in this PR)

## Result

`POST /api/surveys/:surveyId/delegation` no longer crashes the Node process on an
upstream failure, and the delegation action no longer bakes `'undefined'` as the
pool id — both root causes of the nginx 502 / Lit 403 incident. Gates green:
nillcc-backend vitest **80 tests** (baseline 77 + 3 new regression tests), shared
vitest **192 tests** (190 + 2 new owner-decrypt tests), `tsc --noEmit` clean in
both packages.

## What changed

### FIX A — safety (delegation route + global error handling)
- `nillcc-backend/src/app.ts` — wrapped the `POST /surveys/:surveyId/delegation`
  handler in `try/catch` mirroring the `/results` handler: upstream throw →
  `500 { error: 'DELEGATION_FAILED', detail: error.message }` instead of an
  unhandled rejection that kills the process. Added a global Express error
  middleware (after the 404 fallback) so any error that reaches Express
  (synchronous throw, `next(err)`, JSON-body parse failure, a future route
  without try/catch) degrades to `500 { error: 'INTERNAL_ERROR', detail }`.
- `nillcc-backend/src/main.ts` — registered `process.on('unhandledRejection')`
  and `process.on('uncaughtException')` guards that log and keep the process
  alive (no silent swallow), so an upstream 403 can never terminate the backend
  into an nginx 502.

### FIX B — correctness (resolves the 403)
- `nillcc-backend/src/survey.ctrlr.ts` `getUserDelegation` — the
  `NillionPkpClient` is now constructed with the **request** `poolId`
  (`new NillionPkpClient(this.lit, poolId, poolConfig.safe!, contract)`) instead
  of `survey.poolId` parsed from the IPFS config. The create() path never writes
  `poolId` into the config (it spreads the `Survey` object carrying `pool`), so
  the old code baked `isPoolMember('undefined', …)` into the action and produced
  an action CID (`QmdQUdr69…`) no usage key permits → Lit 403. The request poolId
  yields the permitted CID (`QmeMAHg…`). `litPoolKeys.get` and
  `getUserWriteDelegation` still use the request poolId as before.

### FIX C — sibling, same bug class (owner-decrypt path)
- `shared/src/shared/survey/survey.factory.ts` `fetchAndDecryptSurveyWithOwner` —
  the pool id is now sourced from the **on-chain** `fetchSurvey` record (the
  second tuple element) instead of `survey.poolId` read off the parsed
  EncryptedConfig. This removes the same latent `'undefined'` poolId bug on the
  owner-decrypt path (create-path configs carry `pool`, no `poolId`) and fixes
  both the `/api/lit/usage-key` fetch (which 400s on a missing poolId) and the
  `getDecryptForOwnerAction` code. Mirrors the respondent path, which already
  sourced poolId from the chain.

### Regression tests
- `nillcc-backend/src/survey-delegation-502.repro.test.ts` (new, 3 tests):
  - `[A]` delegation route returns `500 { error: 'DELEGATION_FAILED', detail }`
    and still responds (no hang / unhandled rejection) when the upstream Lit call
    throws the 403.
  - `[B]` `getUserDelegation` builds the `NillionPkpClient` with the REQUEST
    poolId (not `undefined`) when the parsed EncryptedConfig carries `pool` and
    NO `poolId`.
  - `[C]` canary: `compactAction(userDelegationAction(<requestPoolId>, contract))`
    contains `isPoolMember('<requestPoolId>', userAddress)`, not the literal
    `'undefined'`.
- `shared/src/shared/survey/survey.factory.test.ts` (+2 tests):
  - owner-decrypt action contains the real (chain-sourced) poolId and no
    `'undefined'`; usage-key fetch uses the chain poolId even for a create-path
    config.
  - update-path config (with `poolId`) still decrypts (regression guard).

## Test / typecheck evidence

```
$ cd nillcc-backend && ./node_modules/.bin/vitest run
 Test Files  8 passed (8)
      Tests  80 passed (80)          # baseline 77 + 3 new

$ cd nillcc-backend && ./node_modules/.bin/tsc --noEmit   # exit 0

$ cd shared && ./node_modules/.bin/vitest run
      Tests  192 passed (192)        # 190 + 2 new

$ cd shared && ./node_modules/.bin/tsc --noEmit           # exit 0
```

Collected test count (nillcc-backend, the gate package): **80**.

## Notes
- No env / human key change was needed: the 403 was a direct consequence of FIX B
  (wrong poolId in the action code), not a stale API key.
- The `shared/dist` build artifact is gitignored; rebuild it before deploy so the
  backend picks up the FIX C source change.
- Follow-up (design fragility, out of scope): per-pool action-CID derivation means
  any template edit silently produces a new CID that no key permits. Consider
  parameterizing poolId via `js_params` instead of interpolating it into the code.
