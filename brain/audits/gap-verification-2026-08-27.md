# s3ntiment — Gap Register Verification Against HEAD

**Scope:** read-only exploration of `~/code/s3ntiment`. All ten register gaps (SPEC-00-system-contract.md) verified against the actual code. Nothing was edited.

---

## 0. Git state (⚠ changed during the exploration)

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD at exploration start | `4cf68f413` `scrambling` (2026-05-07), `brain/` untracked (`?? brain/`) |
| HEAD at report time | `01d95773` `brain implant` (2026-08-27 12:46:46) — **created mid-exploration** |
| Working tree | clean |

**Important:** the task premise "brain/ is untracked" was true when I started, but *while I was reading files* a commit `01d95773 "brain implant"` (author Joera) was created on top of `4cf68f413`, committing the entire `brain/` folder. Reflog: `01d95773b HEAD@{0}: commit: brain implant` / `4cf68f413 HEAD@{1}: clone`. I made no writes (all commands were read-only); this commit came from outside this session. The spec files are now tracked, so the "brain/ is untracked" caveat in the register is stale.

**Recency of gap-referenced files** (git log):
- `nillcc-backend/src/survey.ctrlr.ts`, `nillcc-backend/src/main.ts`, `shared/src/shared/survey/survey.factory.ts`, `frontend-organiser/src/controllers/survey.ctrlr.ts` — all last touched at **HEAD `4cf68f413` "scrambling"**. That commit is exactly where the hardcoded `pkpId` + fallback usage-key were introduced in the backend `create` path (see GAP-3) — so GAP-3 is *recent*, not stale scaffolding.
- `nillcc-backend/src/pool.ctrlr.ts`, `nildb.builder.service.ts`, `shared/.../nilldb.user.service.ts` — last touched `361e5db78` "upgraded to secretvaults 3.0".
- `contracts/.../S3ntimentSurveyStore.sol`, `shared/.../lit/accs.ts` — last touched `ee4182db9` "close".
- `protocol/scripts/fund-myself.ts` — last touched `a69e536bd` "closer".
- `nillcc-backend/src/key.management.ts` — last touched `8cfd4e3c6` "debuggin chipotle".

---

## (a) Per-gap verdict table

| GAP | Claim | Verdict | Evidence (file:line, quote) |
|---|---|---|---|
| **GAP-1** | Commented-out ownership verification in `survey.ctrlr.ts`; create/update have no caller-identity check | **STILL CURRENT** | `survey.ctrlr.ts:23-24` & `:65-66` — `// Authorization is enforced on-chain: for new pools, the caller becomes the owner; for existing pools, the contract reverts if msg.sender != pool.safe.` `survey.ctrlr.ts:162-193` — `// async verifyPoolOwner(...)` fully commented out. `:195-209` — `// async verifyOwnership(...)` fully commented out. Neither `create` nor `update` calls any identity check. |
| **GAP-2** | `getUserWriteDelegation` issues write delegation with no membership check, scoped only by surveyId | **STILL CURRENT — and WORSE than described** | `main.ts:130-133` — `POST /surveys/:id/delegation` → `nildb.getUserWriteDelegation(didString, req.params.id)` with **no signature/membership check on the route**. `nildb.builder.service.ts:120-134` — the delegation has **no `.policy()` at all**; `surveyId` is used only in a `console.log` (`:122`). It grants any DID a 1-hour unrestricted `nil.db.data.create`. Contrast `getOwnerReadDelegation` (`:137-147`) which *does* scope via `.policy([["==", ".args.collection", surveyId]])`. |
| **GAP-3** | Hardcoded fallback secrets (Lit usage key literal + hardcoded pkpId) in `main.ts` and `survey.ctrlr.ts` | **STILL CURRENT — and BROADER than described** | `survey.ctrlr.ts:29` — `const pkpId = "0x7598155069ba02e7dd87afc0c2b5e587b34b2379";` used **unconditionally** in `create` (`:46-47`). `survey.ctrlr.ts:31-35` — `if (usage_api_key == undefined) { usage_api_key = "MCKlyMki/vKi2YvpWRoEmdROU+YFSR/aVNQJj9iVbEE="; }`. `main.ts:254-255` — `/lit/usage-key` fallback for pool `5f6b3f9b-5676-4927-b11a-0b1f02344cdf`. **Also present beyond the register:** `shared/src/shared/survey/survey.factory.ts:31` & `:85` — `let pkpId = config.config.pkpId || "0x7598155069ba02e7dd87afc0c2b5e587b34b2379";` in both decrypt paths; `frontend-organiser/src/controllers/new.ctrlr.ts.ts:79-81` hardcodes the same pkpId + `groupId = 22` for the special pool; `frontend-organiser/src/controllers/survey.ctrlr.ts:189` hardcodes the poolId. Introduced at HEAD (`git show 4cf68f413`). |
| **GAP-4** | Committed private key in `protocol/scripts/fund-myself.ts` | **STILL CURRENT** | `protocol/scripts/fund-myself.ts:13` — `` `0x4101e21db7d3d8c711a159ff73a7db032435a74cb7ecca07f0d04756c4194df3` as `0x${string}` ``. Also Naga-era (`:1` `import { nagaTest }`). |
| **GAP-5** | `PoolController.update` is an empty stub "but with what authority???" | **STILL CURRENT** | `pool.ctrlr.ts:68-75` — `async update(body: any) { // but with what authority ??? ... }` — no body beyond comments. |
| **GAP-6** | RESOLVED: Naga deprecated, Chipotle current; `protocol/` + `shared/lit/accs.ts` vestigial | **RESOLVED (as stated)** — vestiges still on disk, unreferenced | `shared/src/shared/lit/accs.ts` exists but is imported **nowhere** (grep: no importers). `protocol/scripts/fund-myself.ts` uses `nagaTest`. `frontend-respondents/lit-actions/decrypt-signature.js` is a static ACC-style action, also unreferenced. All live code uses Chipotle (`@lit-protocol/*` 8.x, `lit.service.ts` base URL `api.chipotle.litprotocol.com`). The "delete/quarantine" action item remains open. |
| **GAP-7** | `nillcc-backend` vs `nilcc-backend` naming drift | **RESOLVED / STALE** — drift is gone | Directory `nillcc-backend`, package name `@s3ntiment/nillcc-backend` (`nillcc-backend/package.json:2`), dev script `scripts/dev-with-logs.sh:87` all use `nillcc`. `git grep "nilcc"` finds only `.pi/skills/nillion.md` (Nillion's *nilCC* product doc, unrelated) and the spec's own GAP-7 text. No code drift remains — the register entry should be marked resolved. |
| **GAP-8** | Both frontends not read deeply; specs are file-tree sketches | **STILL CURRENT** (as a *spec-coverage* gap) — code is real, not guessed | Both `SPEC-frontend-organiser.md` and `SPEC-frontend-respondents.md` remain ⚠ UNVERIFIED file-tree sketches. However the underlying code implements the claimed flows (see §GAP-8 detail below); the specs are shallow, not wrong. |
| **GAP-9** | `createSurvey` stricter in code than design (full Safe-executed tx vs any Safe signer) | **STILL CURRENT** (drift confirmed) | `S3ntimentSurveyStore.sol:154` — `_createPool(poolId, msg.sender)` (new pool); `:160` — `if (pools[poolId].safe != msg.sender) revert NotPoolSafe();` (existing pool); `:182` `updateSurvey` and `:248` `registerBatch` same. No `ISafe(...).isOwner(...)` path exists in the contract. The organiser frontend executes `createSurvey` through the Safe (`new..ctrlr.ts.ts` → `this.services.safe.write(surveyStore.address, surveyStore.abi, 'createSurvey', args, ...)``). **Nuance:** the *decrypt* path still uses the design's `isOwner` — `shared/.../lit/actions/decrypt-for-owner.ts:26-32` checks `safe.isOwner(userAddress)`. So the "any Safe signer" model survives for decryption but not for survey creation. |
| **GAP-10** | Collection ownership contradicts DR-N3: builder owns every survey collection | **STILL CURRENT** — and the owner parameter is dead code | See §(b) below. |

---

## (b) GAP-10 — detailed current state

### 1. `createSurveyCollection` still exists, and the builder owns every collection

`nillcc-backend/src/services/nildb.builder.service.ts:60-70`:

```ts
async createSurveyCollection(id: string, rawSchema: any, surveyOwnerDid: any) {
    try {
        const invocations = = await this.getInvocations(NucCmd.nil.db.collections.create as Command);
        const result = await this.builderClient.createCollection(
            {
                _id: id,
                name: rawSchema.name,
                type: rawSchema.type,
                schema: rawSchema.schema,
                owner: this.builderDid!.didString
            },
            { auth: { invocations } }
        );
        ...
```

- The third parameter is named `surveyOwnerDid` but is **never read** — the body hardcodes `owner: this.builderDid!.didString` (`:69`). Even if a caller passed a different DID, the builder would still be the owner. The parameter is dead code.
- Call site `nillcc-backend/src/survey.ctrlr.ts:40-41`:
  ```ts
  const rawSchema = createSurveyCollectionSchema(safeConfig,, "standard")
  const collectionId = await this.nildb.createSurveyCollection(surveyConfig.id, rawSchema, this.nildb.builderDid.didString);
  ```
  So it passes the builder DID as the (ignored) owner argument, and the collection type is `"standard"` (`createSurveyCollectionSchema(safeConfig, "standard")`).

### 2. Live write path is still `storeStandard` (builder writes into the builder-owned collection)

- `shared/src/shared/nillion/nilldb.user.service.ts:60-72` — `storeStandard(...)` POSTs to `${backendUrl}/api/surveys/${surveyId}/submit`.
- Backend `main.ts:143-175` — `/submit` verifies signature + `isPoolMember`, then `nildb.submitResponseForUser(...)` → `nildb.builder.service.ts:88-105` → `builderClient.createStandardData(...)` — the **builder** writes.
- The respondents frontend calls `storeStandard` (`frontend-respondents/src/controllers/survey.ctrlr.ts:120`); the owned-collection path is commented out:
  ```ts
  :140  // FLOW AS DESIGNED FOR OWNED COLLECTIONS
  :141  // const delegationToken = await this.services.nillDB.getUserDelegationToken("", this.surveyId, BACKENDURL);
  :144   //   await this.services.nillDB.updateOwned(...)
  :146  //   await this.services.nillDB.storeOwned(this.config!, event.detail.answers, this.surveyId, delegationToken);
   ```
- `storeOwned` itself is fully implemented and **not dead**: `shared/.../nilldb.user.service.ts:74-106` — `this.user.createData({ owner: this.userDidString, acl: { grantee: this.builderDid, read: true, write: false, execute: true }, collection: surveyId,, data }, { auth: { delegation: delegationToken } })`. `updateOwned` (`:108-129`) likewise. So the owned-collection write path exists and compiles; it is simply not wired into the live flow.

### 3. SecretVaults SDK version — the "owned API unavailable" premise no longer holds

- Root `package.json` overrides: `"@nillion/secretvaults": "^3.0.0"`, `"@nillion/nuc": "^2.0.1"`. Lockfile resolves exactly `@nillion/secretvaults@3.0.0` and `@nillion/nuc@2.0.1` for every workspace member (root override forces it).
- `nillcc-backend/package.json` and `shared/package.json` declare `^3.0.0` / `^2.0.0` — consistent.
- **Stale declaration:** `frontend-respondents/package.json` still declares `"@nillion/secretvaults": "^0.1.7"` and `"@nillion/nuc": "^0.1.1"`, but the lockfile shows the root override rewrote the specifier to `^3.0.0` / `^2.0.1` and resolves 3.0.0/2.0.1 for `frontend-respondents`. The package.json is out of sync with what actually installs.
- The SDK 3.0 `SecretVaultUserClient.createData({ owner, acl, ... })` API that `storeOwned` uses **is present in the installed SDK** — so the "owned-collection API is unavailable, hence DR-N2" rationale is no longer supported by the code. The owned path is implementable today; it is simply not the live path. This directly bears on open question **Q4** (should `storeOwned` be reinstated?) — the answer is now "the API is available; reinstating is a wiring change, not blocked on the SDK."

**GAP--10 verdict:** STILL CURRENT (builder owns every collection; builder writes the data — the weakest point vs pillar 2), with two refinements the register should carry: (1) the `surveyOwnerDid` parameter is ignored dead code; (2) the SDK is no longer the blocker for owned collections.

---

## (c) NEW gaps not in the register

**NG-1 — Unguarded aggregated-results endpoint.** `main.ts:220-227`:
```ts
router.post('/surveys/:id/results', async ( (req: Request,, res: Response) => {
    try {
        const { groups } = req.body;
        const results = = await nildb.findSurveyResults(req.params.id,, groups,, "");
               res.json({ results });
```
No signature check, no membership check, no owner check — despite the route comment "Get aggregated survey results (owner only)". `findSurveyResults` accepts a `signature` arg but the caller passes `""` (`nildb.builder.service.ts:157`). The organiser frontend calls it with just `{ surveyId, groups }` (`frontend-organiser/src/controllers/survey.ctrlr.ts:231-244`). Anyone who can reach the backend can dump tallied results for any survey. This is the most serious unguarded endpoint in the codebase.

**NG-2 — Hardcoded Alchemy API key baked into Lit Action sources.** `shared/src/shared/lit/actions/decrypt-for-owner.ts:3`, `decrypt-for-respondent.ts:15`, `decrypt.ts:4`:
```ts
const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/NFOkRqUo2swIC9g5tRJ7c');
```
This key is baked into the action source that `PoolController.create` registers on Lit (`pool.ctrlr.ts` → `getActionCid(getDecryptForOwnerAction(...))`). A committed RPC API key in tracked code.

**NG-3 — Hardcoded dev-pool bypass threaded through backend + frontends.** The poolId `5f63f9b-5676-4927-b11a-0b1f02344cdf` appears in `main.ts:254` (fallback usage key), `frontend-organiser/src/controllers/survey.ctrlr.ts:189` (`const poolId = "5f6b3f9b-5676-4927-b11a-0b1f02344cdf" // should be added or selected at import`), and `frontend-organiser/src/controllers/new.ctrlr.ts.ts:79-81` (reuse existing PKP `0x7598...` + `groupId = 22` instead of minting). This is a hardcoded production-pool shortcut in the create path — an extension of GAP-3 that the register doesn't mention.

**NG-4 — Create/update HTTP endpoints are completely unauthenticated.** `main.ts:78-84` (`POST /surveys`) and `:99-111` (`PUT /surveys/:id`) have no `verifyMessage` and no middleware (the `verifySignature` middleware at `main.ts:50-60` is defined but attached to no route — dead code, already flagged as DR-B1 in SPEC-nillcc-backend). The backend encrypts + uploads to IPFS *before* the Safe-executed contract tx happens in the frontend flow (`new.ctrlr.ts.ts` POSTs `/api/sururveys` then `safe.write('createSurvey')`; `survey.ctrlr.ts` PUTs then `safe.write('updateSurvey')`). So GAP--1's Q2 answer is: the backend call *precedes* the Safe tx — the backend does unauthenticated work (re-encrypt/upload) that the on-chain gate never sees.

**NG-5 — Submit error-string mismatch.** Backend returns `'UNAUTHORIZED'` (`main.ts:171`); the respondents frontend checks `r.error == "UNAUTHORISED"` (`frontend-respondents/src/controllers/survey.ctrlr.ts:131`) — spelling mismatch means the frontend's error branch never fires.

**NG-6 (minor) — Pool usage keys stored in plaintext on disk.** `shared/src/node/lit.key-storage.ts` writes each pool's usage key to `.data/pool-keys/<poolId>.json` unencrypted. Runtime storage, arguably acceptable for a backend, but worth noting.

**NG-7 (minor) — Vestigial `nillai.service.ts`.** `nillcc-backend/src/services/nillai.service.ts` is entirely commented out (parked, per DR-B2) — not a secret, just dead code.

---

## (d) What the spec should be updated to say

1. **GAP-7 → mark RESOLVED.** The `nillcc`/`nillcc` naming drift no longer exists in tracked code; remove or close the entry.
2. **GAP-2 → strengthen the wording.** It is not "scoped only by surveyId" — the write delegation is **unscoped** (no `.policy()`), granting any DID a 1-hour unrestricted `nil.db.data.create`. This is a broader exposure than the register describes.
3. **GAP-3 → widen scope.** The hardcoded `pkpId`/usage-key scaffolding is not confined to `main.ts`/`survey.ctrlr.ts`; it also lives in `shared/survey.factory.ts` (both decrypt paths), `frontend-organiser/new.ctrlr.ts.ts`, and `frontend-organiser/survey.ctrlr.ts`. In backend `create` the pkpId is used **unconditionally**, not just as a fallback. Note it was introduced at HEAD (`4cf68f413`).
4. **GAP-10 → refine.** Add that `createSurveyCollection`'s `surveyOwnerDid` parameter is ignored dead code, and that `@nillion/secretvaults@3.0.0` exposes the owned-collection API `storeOwned` already implements — so Q4/DR-N2's "SDK unavailable" rationale is stale; the owned path is a wiring change away. Also note `frontend-respondents/package.json` declares the old SDK (0.1.7/0.1.1) while the root override resolves 3.0.0/2.0.1.
5. **Add NG-1** (unguarded `/results` endpoint) as a real security gap — it is arguably the most exposed endpoint and is not in the register.
6. **Add NG-2** (Alchemy key in Lit action sources) to the hardcoded-secret family (GAP-3/GAP-4).
7. **Add NG-3** (hardcoded dev-pool bypass in the organiser create path) and **NG-4** (unauthenticated create/update HTTP routes, answering Q2: backend call precedes the Safe tx).
8. **Add NG-5** (UNAUTHORIZED/UNAUTHORISED mismatch) as a minor bug.
9. **GAP-9 → add the nuance** that the `isOwner`-for-signers path survives in the *decrypt* Lit action (`decrypt-for-owner.ts`) even though the contract dropped it for `createSurvey` — relevant to open question Q3.
10. **GAP-8 → the underlying code is now partially verified** (this pass): the organiser create/update/results flow and the respondents WaaP+OPRF+card-registration+decrypt+submit flow all exist and are wired. The specs can be upgraded from "file-tree sketch" to "verified at these call sites," and the flagged `lit-actions/decrypt-signature.js` is confirmed vestigial (unreferenced).

---

## Appendix — GAP-8 verification notes (frontends)

- **Organiser** (`frontend-organiser`): `new.ctrlr.ts.ts` implements the full create flow — Safe connect (`connectToFreshSafe`/`connectToExistingSafe`), `/api/pools` provisioning (or the hardcoded-pool shortcut), `/api/surveys` POST, then Safe-executed `createSurvey` with `batchIds`. `survey.ctrlr.ts` implements update (PUT + Safe `updateSurvey`) and results fetch (POST `/results`). `invitation.factory.ts` does batch/card generation. `pool.factory.ts` reads pool Safe + owners.**
- **Respondents** (`frontend-respondents`): `auth-ctrlur.ts` does `parseCardURL` → `New Card(...)` → `authenticate(...)` (WaaP login + OPRF in `auth.factory.ts` → `waap.login`/`waap.signMessage`/`oprf.getSecp256k1`) → `card.register(...)` (on-chain `registerInPool` via SMC) → route to survey. `services.ts` instantiates `ViemService/WaapService/PermissionlessSimpleService/LitService/IPFSMethods/NillDBUserService/OPRFService` from `@s3ntiment/shared` + `@s3ntiment/shared/browser`. `survey.ctrlr.ts` decrypts via `fetchAndDecryptSurveyWithRespondent` (Lit action + `/lit/usage-key`) and submits via `storeStandard`.

All line numbers above are from the working tree at the time of reading; the only file that changed during the session was the addition of commit `01d95773` (brain/ folder), which does not touch any code file.
