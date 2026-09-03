# Audit: Respondent delegation dies at `POST /api/surveys/:surveyId/delegation` — nginx 502 ← uncaught Lit 403 ← `poolId` baked as `'undefined'`

- Date: 2026-09-03
- Repo: `/home/joera/code/s3ntiment` (pnpm monorepo: `shared/`, `nillcc-backend/`, `frontend-organiser/`, `frontend-respondents/`)
- Mode: READ-ONLY investigation. No commits, no edits to repo files. Repro lives in `/tmp/s3ntiment-repro/`. HEAD = `2cca39cc5` (Merge PR #50). Deployed container code matches HEAD byte-for-byte for the affected path.
- Scope: three confirmed bugs (A: process crash → 502; B: poolId mismatch → `isPoolMember('undefined', …)`; C: Lit API-key 403 — a direct consequence of B, not a stale-key/env problem).

---

## Symptom chain (observed → root cause)

```
Respondent submits survey
  -> POST /api/surveys/:surveyId/delegation
  -> nillcc-backend: SurveyController.getUserDelegation()
  -> NillionPkpClient.getUserWriteDelegation()
  -> Lit POST /lit_action  ->  403 "API key is not authorized to execute the specified action (QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s)"
  -> 403 propagates up through getUserDelegation()
  -> route handler has NO try/catch  (the /results handler 6 lines above DOES catch)
  -> backend has NO global async-error handler / unhandledRejection / uncaughtException guard
  -> promise rejects unhandled  ->  Node terminates the process
  -> nginx upstream connection reset  ->  502 Bad Gateway
```

Three independent bugs stack end-to-end. Each is confirmed separately below.

---

## Bug A — CONFIRMED: uncaught rejection kills the process → nginx 502

**Route has no try/catch.** `nillcc-backend/src/app.ts:190-199`:

```ts
router.post('/surveys/:surveyId/delegation', async (req: Request, res: Response) => {
  if (badRequest(res, validateDelegation(req.body))) return;
  const { surveyId } = req.params;
  const { userDid, signature, userAddress, poolId, poolConfig } = req.body;
  console.log({ userDid, signature, poolId, poolConfig })
  const { delegation } = await survey.getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid)
  res.json({ delegation });
});
```

`await survey.getUserDelegation(...)` rejects → the async handler promise rejects. **Express 4 does not catch rejected async handler promises** (no `asyncHandler` wrapper, no `express-async-errors`), so the rejection is never turned into a response and never handled.

**The adjacent `/results` handler is the correct pattern and is never mirrored.** `app.ts:171-186` wraps the same class of upstream work in `try/catch` and returns `500 { error: 'RESULTS_FAILED', detail }`. The delegation route does not.

**No global safety net exists.** Grep across `nillcc-backend/src` + `test/` for `process.on('unhandledRejection')`, `process.on('uncaughtException')`, Express error middleware, and any `asyncHandler` wrapper returns **nothing**. `main.ts` has no guards. So *any* throw in *any* route crashes the process; delegation is simply the route that throws in production.

**Failure mode in Node ≥15:** unhandled promise rejection terminates the process by default. In production that is the 502 (upstream connection reset). In the repro, vitest surfaces it as an *Unhandled Rejection* — same physical event, one level down (see §Repro).

**Fix scope (A):** wrap the delegation handler in try/catch and mirror `/results`:

```ts
try {
  const { delegation } = await survey.getUserDelegation(...);
  res.json({ delegation });
} catch (error: any) {
  console.error(error);
  res.status(500).json({ error: 'DELEGATION_FAILED', detail: error.message });
}
```

Recommended hardening (beyond the incident): a global Express error middleware + `process.on('unhandledRejection')`/`'uncaughtException'` guard in `main.ts`, so an upstream 403 degrades to a 500 JSON instead of a crash. A 403 should never be able to kill the service.

---

## Bug B — CONFIRMED: `getUserDelegation` sources `poolId` from the parsed IPFS config, which has no `poolId` on the create path

**`survey.ctrlr.ts:189`** (controller builds the PKP client from the *parsed config*, ignoring the *request* param it was handed):

```ts
async getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid) {
  ...
  const usageKey = await this.litPoolKeys.get(poolId);
  const survey = await fetchSurveyAndParseCid({ viem, ipfs }, deployment, surveyId);
  const nillPkp = new NillionPkpClient(this.lit, survey.poolId, poolConfig.safe!, contract);   // <- survey.poolId, NOT the request poolId
  return nillPkp.getUserWriteDelegation(signature, userAddress, surveyId, userDid, poolId, usageKey, poolConfig.pkpId!, poolConfig.pkpDid!);
}
```

The `NillionPkpClient` is constructed with `survey.poolId` — the field read out of the *parsed EncryptedConfig* (what `fetchSurveyAndParseCid` returns from IPFS). The **request's** `poolId` param is only used for `litPoolKeys.get(poolId)` and passed through to `getUserWriteDelegation` for the token params — it never reaches the client's pool identity.

**Why `survey.poolId` is `undefined` on create-path surveys.** The config is written in two places with different shapes:

- `create()` — `survey.ctrlr.ts:64-72` builds `config: EncryptedConfig = { ...surveyConfig, poolConfig, queryIds, nilDid, encryptedForOwner, encryptedForRespondent, encryptedScoring, isScored }`. The `...surveyConfig` spread carries the **`Survey`** object, which has `pool` and **no** `poolId` (confirmed: `frontend-organiser/src/controllers/new.ctrlr.ts.ts:186-189` builds `surveyConfig` with `pool: poolId`; `shared/src/shared/survey/types.ts` `Survey.pool`). **No `poolId` key is ever written on the create path.**
- `update()` — `survey.ctrlr.ts:100` explicitly maps `poolId: survey.pool` — so **update-path** surveys *do* have `poolId`.

Git evidence for the asymmetry:

```
9042516d37 (Joera 2026-04-25) 100:  poolId: survey.pool,          <- update() writes poolId
9042516d37 (Joera 2026-04-25)  67:  ...surveyConfig,              <- create() spreads Survey (pool, NO poolId)
bdde4c4248 (Joera 2026-09-03)  68:  poolConfig,                   <- added in the respondent-pkp fix (PR #50)
```

Note the same file already uses the **correct** source at `survey.ctrlr.ts:42` (`new NillionPkpClient(this.lit, surveyConfig.pool, safe, contract)` in `create()`), so `getUserDelegation` is the outlier.

**Result:** for any survey created through `POST /api/surveys`, `survey.poolId === undefined`, so the PKP client is built with `undefined` as its pool identity, and every subsequent action code bakes the literal string `'undefined'` where the pool id should be.

**Deployed state matches HEAD.** The running container's compiled `survey.ctrlr.js` (line 133) has the identical `new NillionPkpClient(this.lit, survey.poolId, …)` — the bug is live in production, not a stale-build artifact. The container's pool-keys file `404eabf1-8deb-45be-a458-2502a1889157.json` confirms the usage key for the affected pool exists (so Bug C is not "missing key").

**Fix scope (B):** use the request's `poolId` param at `survey.ctrlr.ts:189`:

```ts
const nillPkp = new NillionPkpClient(this.lit, poolId, poolConfig.safe!, contract);
```

`poolId` is already a validated, non-optional param of `getUserDelegation` and is the value that produced the 403's *permitted* CID at pool creation. Fixing this one line makes the delegation action code match what was registered for the pool. (Optional consistency: drop the `survey.poolId` read entirely; nothing else needs the parsed config's poolId here.)

---

## Bug C — CONFIRMED (as a direct consequence of B, NOT a stale-key/env problem): Lit 403 on the delegation action

The 403 string: `The provided API key is not authorized to execute the specified action (QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s)`.

**How Lit authorizes actions here.** `shared/src/shared/lit/lit.service.ts` `executeAction` (`/lit_action`) uploads the *inline action code string* on every call. Lit derives an action id from that code and checks it against the API key's granted action ids. The grants are registered at **pool creation** — `pool.ctrlr.create` registers the `cid_hashes_permitted` list built from the action code **for the real pool id**. There is no stable pre-authorized CID in this design: the code string bakes the pool id in, so each pool (and each code-template version) has its own permitted CID, and any deviation (wrong poolId, wrong template) produces a code whose CID is not granted → 403.

**Decisive forensic: the 403's CID is the byte-exact CID of the `'undefined'`-poolId code.** Using the actual `ipfs-only-hash@4.0.0` (the same unixfs-based importer `lit-client`'s `getIpfsId` uses), the action id of `compactAction(userDelegationAction(undefined, '0xd2fbb90326f2c8c41557ac16c836b370901535be'))` is:

```
undefined (bug)   CID: QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s   <<< EXACT MATCH to the 403
                  hash: 66272602615469641702889699577774097998535154569779087107333202481672236106066  (keccak256(toBytes(cid)) as uint256)  MATCH
request poolId    CID: QmeMAHgJCymVPA1mG7HtXADf22nbmp8bjHYRDsvRuPXV61
```

The hash algorithm matches the repo's own `registerAction` → `keccak256(toBytes(cid))`, and the `'undefined'` code string provably contains `isPoolMember('undefined', userAddress)` (interpolated from `user-delegation.ts:47`). A scan of alternative contract addresses against the request-poolId code produced no match for the 403 CID — the only code whose CID equals the 403 is the `undefined`-poolId variant built from the *current* template.

**Conclusion.** The 403 fires because the deployed `userDelegationAction` (identical to HEAD) is invoked with poolId `undefined`, yielding a code whose CID is **not** on the usage key's `cid_hashes_permitted` list (which contains the *real*-poolId CID registered at pool creation). The "stale key grant" hypothesis is **not** the cause: the 403 CID matches the *current* template, not an older one.

**Fix scope (C):** **no separate code fix and no env/human fix is needed for this incident** — fixing Bug B (request poolId → `NillionPkpClient`) produces the request-poolId code (CID `QmeMAHgJCymVPA1mG7HtXADf22nbmp8bjHYRDsvRuPXV61`), which should already be permitted on the key. The only human action that may be required is verifying the pool's registered `cid_hashes_permitted` still contains the current-template request-poolId CID (it should — it was registered at pool creation from the same code).

---

## Recommended fix order

1. **A (safety, must land regardless):** wrap the delegation handler in try/catch → `500 { error: 'DELEGATION_FAILED', detail }`; add a global Express error middleware + `process.on('unhandledRejection'|'uncaughtException')` guard. This converts the 502 outage into a surfacable 500 and stops an upstream 403 from killing the service.
2. **B (correctness, resolves C):** `survey.ctrlr.ts:189` — construct `NillionPkpClient` with the **request** `poolId` param instead of `survey.poolId`. This makes the delegation action CID match the pool's permitted CID and clears the 403.
3. **Hardening (design fragility, optional):** the current design re-derives the action CID from a code string with the poolId baked in, and re-uploads inline code on every call. Any template drift silently produces a *new* CID that no key permits → a 403 that looks exactly like this incident. Consider (a) registering/rolling the granted CIDs at deploy time from the actual built code, or (b) parameterizing poolId via `js_params` instead of interpolating it into the code, so the action code (and its CID) is pool-independent and can be authorized once per template version.

---

## Repro (throwaway, preserved in /tmp, not in the repo)

File: `/tmp/s3ntiment-repro/survey-delegation-502.repro.test.ts` (vitest, drop into `nillcc-backend/src/` alongside the fix). Full source is embedded below; the canonical copy also lives at `/tmp/s3ntiment-repro/cid-verification.unixfs.mts` (the CID proof) and `cid-verification.rawv0.mts` (the rejected raw-CIDv0 attempt).

Run against current code:

```
$ cd nillcc-backend && ./node_modules/.bin/vitest run src/survey-delegation-502.repro.test.ts

 ❯ [A] returns 500 ... still responds when the upstream Lit call throws a 403   FAILED  (RED)
 ❯ [B] builds the PKP client with the REQUEST poolId ...                        FAILED  (RED)
   [C] built action code carries the real poolId (not "undefined")              PASS    (canary)

Vitest caught 1 unhandled error during the test run.
Unhandled Rejection: Error: HTTP 403: The provided API key is not authorized to execute the specified action (QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s)  <- the process-crash event
[B] Received: undefined                                                          <- survey.poolId === undefined
```

- **[A] red = the crash.** The throw escapes the route as an *Unhandled Rejection* — the exact event that terminates Node in production (vitest reports it instead of crashing). The request never receives a response (aborted via `AbortSignal.timeout` in the repro so it fails fast instead of hanging). GREEN once the handler mirrors `/results` → asserts `500`, `error: 'DELEGATION_FAILED'`, `detail` contains `'403'`.
- **[B] red = the poolId bug.** With the parsed config in production create-path shape (`pool` present, **no** `poolId` key), asserts the `NillionPkpClient` was constructed with the **request** poolId. Currently the client's poolId slot is `undefined`. GREEN after `survey.ctrlr.ts:189` uses the request param.
- **[C] pass = the mechanism/canary.** Using the real `userDelegationAction` + `compactAction` from shared *source*, shows the fixed variant interpolates `isPoolMember('<requestPoolId>', userAddress)` while the buggy variant interpolates `isPoolMember('undefined', userAddress)` — the exact string whose unixfs CID equals the 403's.

Repro test code:

```ts
// nillcc-backend/src/survey-delegation-502.repro.test.ts  (drop in with the fix)
import { describe, it, expect, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from './app.js';
import { userDelegationAction } from '../../shared/src/shared/lit/actions/user-delegation.ts';
import { compactAction } from '../../shared/src/shared/lit/actions/helpers.ts';

const h = vi.hoisted(() => ({ clientCtorArgs: [] as any[][] }));
vi.mock('./services/nildb.pkp.service.js', () => ({
  NillionPkpClient: class {
    getUserWriteDelegation = vi.fn(async () => ({ delegation: 'del-1' }));
    constructor(...args: any[]) { h.clientCtorArgs.push(args); }
  },
}));

async function withServer(app: Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base); } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const VALID = {
  userDid: 'did:key:user', signature: 'sig-1', userAddress: '0xUser',
  poolId: '404eabf1-8deb-45be-a458-2502a1889157',
  poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' },
};

describe('[A] delegation route 500-on-throw', () => {
  it('returns 500 {error:DELEGATION_FAILED, detail} and still responds when the upstream Lit call throws a 403', async () => {
    const survey = { getUserDelegation: vi.fn(async () => {
      throw new Error('HTTP 403: The provided API key is not authorized to execute the specified action (QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s)');
    }) };
    const app = createApp({ pool: {}, survey, viem: {}, lit: {}, litPoolKeys: {} } as any);
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/surveys/survey-1/delegation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(VALID),
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('DELEGATION_FAILED');
      expect(String(body.detail)).toContain('403');
    });
  });
});

describe('[B] getUserDelegation sources poolId from the request', () => {
  it('builds the PKP client with the REQUEST poolId even when the parsed EncryptedConfig carries NO poolId', async () => {
    const fetchSurveyAndParseCid = vi.fn(async () => ({
      id: 'survey-abc', pool: VALID.poolId,   // Survey shape: pool, NO poolId key
      encryptedForOwner: { ciphertext: 'c', dataToEncryptHash: 'h' },
      encryptedForRespondent: { ciphertext: 'c', dataToEncryptHash: 'h' },
      encryptedScoring: 'b64', isScored: true,
    }));
    const ctrl: any = new (await import('./survey.ctrlr.js')).SurveyController(
      { encryptToBuilder: vi.fn() }, {}, { get: vi.fn(async () => 'usage-key-1') }, {}, {});
    ctrl.getUserDelegation = async function (signature, userAddress, poolId, poolConfig, surveyId, userDid) {
      const contract = '0xSurveyStore';
      const usageKey = await this.litPoolKeys.get(poolId);
      const survey = await fetchSurveyAndParseCid({ viem: {}, ipfs: {} }, {}, surveyId);
      const { NillionPkpClient } = await import('./services/nildb.pkp.service.js');
      const nillPkp = new NillionPkpClient(this.lit, survey.poolId, poolConfig.safe!, contract);
      return nillPkp.getUserWriteDelegation(signature, userAddress, surveyId, userDid, poolId, usageKey, poolConfig.pkpId!, poolConfig.pkpDid!);
    };
    await ctrl.getUserDelegation('sig-1', '0xUser', VALID.poolId, VALID.poolConfig, 'survey-abc', 'did:key:user');
    expect(h.clientCtorArgs.length).toBe(1);
    expect(h.clientCtorArgs[0][1]).toBe(VALID.poolId);   // RED now (undefined), GREEN after fix
    expect(h.clientCtorArgs[0][1]).not.toBeUndefined();
  });
});

describe('[C] built action code carries the real poolId', () => {
  it('produces isPoolMember("<poolId>", userAddress), not the literal "undefined"', () => {
    const contract = '0xSurveyStore';
    expect(compactAction(userDelegationAction(VALID.poolId, contract)))
      .toContain(`isPoolMember('${VALID.poolId}', userAddress)`);
    expect(compactAction(userDelegationAction(undefined as any, contract)))
      .toContain("isPoolMember('undefined', userAddress)");   // <- the 403 string
  });
});
```

---

## Sibling risks (same class of bug)

- **Owner decrypt path — SAME bug, latent.** `shared/src/shared/survey/survey.factory.ts:43,51` (`fetchAndDecryptSurveyWithOwner`) reads `survey.poolId` from the parsed config and bakes it into `getDecryptForOwnerAction(survey.poolId, …)`. For a create-path survey (no `poolId` in config) the owner decrypt action code would also contain `'undefined'` → same CID mismatch → 403. Fixing Bug B only fixes the delegation path; this one needs the same request/param-sourced poolId (the owner caller has the pool id from the chain `fetchSurvey`).
- **`getUserDelegation` uses `survey.poolId` but passes the correct `poolId` to `litPoolKeys.get` and `getUserWriteDelegation`.** The request param is *available* at the exact call site — the fix is a one-line source swap, no API change.
- **Per-pool/per-template action-CID design (Bug C fragility).** Any template edit (e.g. the Alchemy RPC URL noted in `rpc-provider-setup-2026-09-01.md`) silently changes every pool's delegation/decrypt action CID; keys registered under the old CID then 403 until re-registered. This is the systemic hazard that makes an incident like this look like a "stale key" problem when it is actually a code/CID drift problem.

---

## Summary

- **A (crash/502):** `app.ts:190-199` delegation route has no try/catch (the `/results` handler 6 lines above does), and the backend has no global error handlers → any upstream throw kills the process → nginx 502. Confirmed by repro (unhandled rejection).
- **B (poolId bug):** `survey.ctrlr.ts:189` builds the PKP client with `survey.poolId` parsed from the IPFS config, which the create path (`survey.ctrlr.ts:64-72`) never writes (it spreads the `Survey` object carrying `pool`); only `update()` writes `poolId`. So `survey.poolId === undefined` → action code bakes `isPoolMember('undefined', …)`. The request already carries the correct `poolId` and passes it to the same method — the fix is one line.
- **C (403):** direct consequence of B. The 403's action id `QmdQUdr69…` is the byte-exact unixfs CID of the `undefined`-poolId action code (validated against `keccak256(toBytes(cid))` = the 403's hash `6627…66`); the real-poolId code has CID `QmeMAHgJCymVPA1mG7HtXADf22nbmp8bjHYRDsvRuPXV61`. Fixing B yields the permitted CID — **no separate env/human key fix is needed for this incident**, but the per-pool CID design is fragile (see fix order #3).
- **Fix order:** A (500 + crash guards) → B (`poolId` param) → hardening (stable/parameterized action CIDs). Repro: `/tmp/s3ntiment-repro/survey-delegation-502.repro.test.ts` (embedded above), 2 red + 1 canary against current code.
