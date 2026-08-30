# Task 2 — `/account` route & "secure your stealth account" exploration

**Date:** 2026-08-30 · **Purpose:** read-only explore (no code changed)
**Scope:** existing seams in `frontend-respondents`, `shared`, `contracts` needed to implement
Task 2 — the post-survey "secure your stealth account" flow on a dedicated `/account`
route (replaces the `/secure` idea). Every claim is file+line cited against the current
`main`.

---

## Summary

All the client-side building blocks PR #21 shipped are in place and callable: the results page
(`CompletedController`), the submit handler (`SurveyController.setSurveyListener`), the extracted
`humanWallet.factory.ts` (WaaP+OPRF → derived leaf S), the bootstrap-`E` storage
(`BOOTSTRAP_STORAGE_KEY='bootstrapE'`), the Pimlico ERC-4337 paymaster write path, and the per-leaf
nilDB `storeOwned`. The returning-user **recover** path (Case 2) needs zero on-chain writes: S is
already a member, re-derivation natively recovers S's records. **The single material gap is the
first-time E→S *register S* step:** the only contract registration function, `registerInPool`, is
nullifier-bound — the entry card's nullifier is already spent, so registering a *fresh* S on a
first-time secure reverts `NullifierAlreadyUsed`. There is no nullifier-less "add member" function
and no second-card mechanism. The paymaster *paying* is wired (`PermissionlessSimpleService` +
Pimlico), but the *thing to pay for* (a S registration tx) has no valid call today. Details below.

---

## 1. Results / survey-complete page

- **Post-submit navigation:** `SurveyController.setSurveyListener()` (`frontend-respondents/src/controllers/survey.ctrlr.ts:119`),
  on the `survey-complete` event, after `storeOwned` succeeds does
  `if (result.ok) router.navigate('complete/${this.surveyId}/${docIUd}')` (`survey.ctrlr.ts:154`).
  The `survey-complete` event is dispatched by the `<survey-questions>` component with
  `detail.answers` (`frontend-respondents/src/components/survey-questions.ts:519-528`).
- **Route:** `/complete/:surveyId/:docId` → `CompletedController` (`frontend-respondents/src/router.ts:90-99`).
- **Results / completion component:** `CompletedController` (`frontend-respondents/src/controllers/completed-ctrlr.ts:8`).
  Its `renderTemplate()` (`completed-ctrlr.ts:22`) currently renders "Thank you for your feedback /
  It's fine to close this window now" (`completed-ctrlr.ts:41-42` unscored; `:46-48` scored), with a
  score block for scored surveys (`:34-44`). If scored it fetches `/api/surveys/:id/score`
  from `store.activeSurvey.pool` (`completed-ctrlr.ts:60-74`).
- **State available there:** `store.activeSurvey` (SurveyEntry) and `store.activeSurvey.pool`
  (set in the survey gate `router.gates.ts:59-66` and `survey.ctrlr.ts:137`); the acting leaf
  signer via `this.services.account.getSignerAddress()` (`completed-ctrlr.ts:54` uses it for
  scoring); `surveyId`/`docId`. Survey answers are **not** in the controller — they were written to
  nilDB at submit (`survey.ctrlr.ts:150` `storeOwned`); the submit handler holds `event.detail.answers`
  transiently (`survey.ctrlr.ts:150`).
- **CTA mount point:** inside `CompletedController.renderTemplate()` (`completed-ctrlr.ts:22-52`),
  gated on the new `anchor_address === undefined`, adding a "secure your account" button that
  `router.navigate('/account')`. `#btn-close` listener is the existing interaction seam
  (`completed-ctrlr.ts:95-99`).

## 2. Routing

- Router is **Navigo** (custom JS router, no react-router): `const router = new Navigo('/')`
  (`frontend-respondents/src/router.ts:21`), wired in `initRouter` (`router.ts:25`).
- **Route table** (`router.ts`):
  - `/` → `AuthController`, with `resolveRootGate` `before` guard (`router.ts:28-48`; guard `router.gates.ts:18-52`)
  - `/invalid-card` → `InvalidCardController` (`router.ts:49-56`)
  - `/used-card/:surveyId` → `UsedCardController` (`router.ts:57-65`)
  - `/surveys/:surveyId` → `SurveyController`, with `resolveSurveyGate` `before` guard (`router.ts:66-89`; guard `router.gates.ts:54-73`)
  - `/complete/:surveyId/:docId` → `CompletedController` (`router.ts:90-99`)
  - `router.resolve()` at `router.ts:145`. (A commented-out legacy route block sits at `router.ts:108-144`.)
- **Adding `/account`:** append a new chained handler after line 99, before the commented block, e.g.
  `.on('/account', () => { if (currentController?.destroy) currentController.destroy(); currentController = new AccountController(services); removeSplash(); currentController.render(); })`
  following the established `currentController` destroy/render pattern used by every route
  (`router.ts:29-32`, `:58-60`, `:91`). Links are rendered by calling `router.navigate(path)`
  imported from `../router.js` (used at `survey.ctrlr.ts:154`, `auth-ctrlr.ts:82`, `used-card-ctrlr.ts:80`).
- **Guards:** only `/` and `/surveys/:surveyId` have `before` guards; `/complete` and others run
  unguarded. A new `/account` route would have **no guard** unless one is added (none is needed —
  the route must be reachable post-survey and work whether or not secured).
- **No `/secure` and no `/account` route exists** (grep of `router.ts` returns nothing; full-repo grep
  for `secure`/`anchor` route symbols is empty). This is a net-new route.

## 3. humanWallet.factory invocation

File: `frontend-respondents/src/humanWallet.factory.ts`. Two exports:

- `authenticate(services: IServices, poolId: string): Promise<boolean>` (`humanWallet.factory.ts:17`):
  `waap.login(base)` (`:19`) → `waap.signMessage("Sign in with your unlinkable account for respondent pool ${poolId}")`
  (`:20`) → `oprf.getSecp256k1(input)` returns the derived `key` (`:21`) → `account.updateSignerWithKey(key)`
  (`:22`) → returns `hasParticipatingAccount(services, poolId)` (`:24`).
- `hasParticipatingAccount(services, poolId): Promise<boolean>` (`:27`): returns false if
  `getSignerAddress()==='0x'`, else `viem.read(isPoolMember,[poolId, signer])` (`:31-37`).
- **Inputs needed:** `services.waap`, `services.oprf`, `services.account`, `services.viem` — all in
  the `IServices` contract and initialized in `ServiceContainer.initialize` (`frontend-respondents/src/services.ts:20-27,44-66`).
  `poolId` is already in scope post-survey: `store.activeSurvey.pool` (`survey.ctrlr.ts:137`, `router.gates.ts:59-66`).
  `base` chain imported at `humanWallet.factory.ts:1`. So calling `authenticate(services, poolId)` from
  `/account` needs **no new setup** — WaaP login + OPRF wasm initialize on first call (both are now
  deferred, per the comment `services.ts:82-88`).
- **Return shape — a seam to flag:** `authenticate` returns only a `boolean` (membership). The derived
  leaf key `key` (`:21`) is consumed inside by `updateSignerWithKey(key)` and **not returned or
  persisted**. This satisfies `hasParticipatingAccount`, but the Task 2 decision ("persist derived S's
  private key locally") means the caller must either refactor `authenticate` to return/expose `key`, or
  re-call the OPRF step directly. The derived key value is the only place S is materialized for
  storage; today it is lost after `updateSignerWithKey`.

## 4. E→S rotation seams to BUILD (first-time secure)

Given the acting leaf is bootstrap E (set at entry by `ensureBootstrapKey`, `bootstrap.factory.ts:14-25`)
and the /account step derives S:

- **(a) Derive S:** reuse `humanWallet.factory.ts:17-24` (or a refactor returning `key`) — WaaP login,
  OPRF `getSecp256k1` → S key → `account.updateSignerWithKey` swaps E→S.
  **Exists-to-reuse:** `authenticate`/`hasParticipatingAccount` (`humanWallet.factory.ts`), `updateSignerWithKey`
  (`permissionless.simple.service.ts:46-50`). **Must build:** returning the key for local persistence.
- **(b) Register S on contract — THE GAP.** The only registration fn is `registerInPool`
  (`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:419-469`), which is **card-bound**:
  it requires a valid unused `nullifier`+`signature`, checks `usedNullifiers[poolId][messageHash]` and
  reverts `NullifierAlreadyUsed` (`:454`), burns the nullifier (`:457`), and sets
  `poolMembers[poolId][poolWallet] = true` (`:466-467`). In the first-time secure case E was already
  registered at entry with the card (`auth-ctrlr.ts:79-82` → `Card.register` `card.factory.ts:95-103`),
  so the entry card's nullifier is **spent** — re-calling `registerInPool` with it reverts
  `NullifierAlreadyUsed`. There is **no nullifier-less "add member" write** (only `revokeMember`,
  `:483`; no `addMember`), and no second card in the flow. So the RFC §5.2 step "register S" has **no
  working on-chain seam** today for a first-time secure. (Contrast: returning-user S is already a
  member — see §5.) This needs a decision (see Implications).
- **(c) Migrate nilDB docs E→S.** Building blocks today:
  - `getUserSurveyAnswers(surveyId)` reads a leaf's records by listing data refs and reading
    (`shared/src/shared/nillion/nilldb.user.service.ts:151-167`).
  - `storeOwned(uuid, survey, poolConfig, answers, surveyId, delegation)` writes under the current
    init'd signer as `owner: this.userDidString` with the pool PKP granted acl (`nilldb.user.service.ts:59-67`, `createData` `:83-116`).
  - `updateOwned(...)` is a **same-owner** delete+recreate (`nilldb.user.service.ts:69-75`) with **no
    production call site** (confirmed by audit; `listDataReferences`/`init` `:29-41`).
  - A **cross-leaf** E→S move needs either a two-client delete+recreate (init a NillDBUserService under
    E to delete, under S to recreate — `init(seed)` is per-leaf, seed = `account.createNillDBSeed()`
    (`permissionless.simple.service.ts:197-199`)) **or** a raw Nillion `POST /v1/users/data/acl/grant`
    wrapper — **no acl wrapper exists anywhere in `shared`/`frontend-respondents`/`nillcc-backend`
    (grep for `acl/grant` empty)**. RFC §11 explicitly earmarks "record migration helper for leaf→leaf"
    as **to build**.
  - (b)/d per the per-leaf model: `did:key` from the seed (`shared/src/shared/nillion/did.ts:3`,
    `publicKeyToDidKey`), so re-derived S natively re-derives the same did:key as a prior S.
- **(d) Wipe bootstrapE + persist S + set `anchor_address`.** Storage helpers in
  `frontend-respondents/src/state/storage.ts`: `BOOTSTRAP_STORAGE_KEY='bootstrapE'` (`:13`),
  `loadBootstrapKeyFromStorage` (`:15-26`, validates `/^0x[0-9a-fA-F]{64}$/`), `saveBootstrapKeyToStorage` (`:28-32`).
  **No `removeItem` helper for the key, and no `anchor_address` / derived-S helper exists.**
  **Must build:** `load/saveAnchorAddressFromStorage`, `load/saveDerivedSKeyFromStorage` (or generalize
  the bootstrap pattern), and a `clearBootstrapKey`/remove helper for N1 (wipe E). Note the existing
  helpers are `console.warn`-guarded and validate the 64-hex form — follow that shape.

**Exists-to-reuse:** `getUserSurveyAnswers`, `storeOwned`, `createNillDBSeed`, `init`, the bootstrap
key read/write, the `humanWallet` derive, Pimlico `account.write`. **Must build:** derive-key return;
S registration (see gap); cross-leaf E→S migration (delete+recreate or acl wrapper); anchor flag +
derived-S storage; wipe-E helper; the `/account` controller+routes; the results-page CTA.

## 5. Returning-user recover/re-assign (Case 2, fresh device)

Confirmed against `brain/audits/returning-invite-recovery-2026-08-30.md` (Q5 done earlier there):

- Fresh device boots **E2** and registers it against the fresh nullifier N2 (`auth-ctrlr.ts:79-82`,
  `Card.register` `card.factory.ts:95-103`). In `/account` the user reveals the earlier anchor → derive S
  (`humanWallet.factory.ts:17-24`). S is **already a member** of that pool + **already owns its records**,
  so **no registration write and no record migration for S's own earlier records** — re-derivation
  natively recovers them (same seed → same did:key → same Nillion seed; `permissionless.simple.service.ts:197-199`,
  `did.ts:3`). Zero on-chain writes (RFC §4.6; audit §5).
- **Avoid re-registering S:** calling `registerInPool` for an already-member leaf reverts
  `AlreadyPoolMember` (`S3ntimentSurveyStore.sol:466`; test `contracts/test/S3ntimentSurveyStore.test.ts:1270`).
  So the recover path must **skip** registration (the audit's §1, §2 confirm this; also E2's own fresh
  registration already needs care — redeeming N2 as E2 creates an orphan E2 member/record set).
- **Migrate E2's *new* docs onto S:** E2→S is the SAME cross-leaf problem as §4(c) — **does not exist**
  (audit §3). Needs the to-build helper (two-client delete+recreate with both keys live in one session,
  or an `acl/grant` wrapper). `updateOwned` (`nilldb.user.service.ts:69-75`) is same-owner only, no call site.
- **Wipe E2:** same missing `clearBootstrapKey` helper as §4(d) (N1).
- So the returning path reuses: the derive factory, `getUserSurveyAnswers`, `storeOwned`, `init`,
  `createNillDBSeed`. Must build: E2→S cross-leaf migration, wipe, anchor-flag set.

## 6. Paymaster / registration reality (DR-C6)

- **Yes, a paymaster/relayer path is wired and is the live one used today.** The respondent signer is an
  **ERC-4337 smart account** via `PermissionlessSimpleService` (`shared/src/shared/evm/permissionless.simple.service.ts`):
  `createPimlicoClient` (`:33`), `toSimpleSmartAccount` + `createSmartAccountClient` with `paymaster: this.pimlicoClient`
  (`:75-80`, bundler+paymaster `:83-84`), and `write()` sends a userOp via `sendTransaction` (`:97-118`).
  `VITE_PIMLICO_KEY` and `VITE_ENTRYPOINT_ADDRESS_V07` are set in `.env` (`:19-20`). This exact path pushes
  `registerInPool` at entry via `Card.register` → `account.write` (`card.factory.ts:95-103`; `auth-ctrlr.ts:79-82`).
- **So calling `services.account.write(...)` from `/account` to push a registration tx would "just work"
  for the userOp+paymaster plumbing** — same service, same Pimlico sponsor, fresh S signer derived by
  `updateSignerWithKey` (`permissionless.simple.service.ts:46-50`).
- **BUT the *call it would make* does not exist as a valid function for first-time secure:** as §4(b),
  `registerInPool` is nullifier-bound and the entry card is spent → `NullifierAlreadyUsed` revert
  (`S3ntimentSurveyStore.sol:454`). There is **no contract function to register a fresh derived leaf S
  without a new nullifier** (no `addMember`; only `registerInPool` `:419` and `revokeMember` `:483`).
- **Gap to flag:** the tx-funding mechanism is present (Pimlico paymaster), but the *transaction to fund*
  for a first-time secure (S registration) has no valid calldata today. Options to decide: (1) operator
  mints a second card per respondent for the S registration (changes INV-2 "one on-chain write per
  respondent" — actually S registration *is* a second write), (2) add a nullifier-less
  `registerDerivedLeaf(poolId)` member-add to the contract (rejected by RFC §11 "add nothing for
  rotation" — tension to resolve), or (3) treat first-time secure as **not** re-registering and accept
  membership stays on E (contradicts the "S is member" model). The **returning** recover case needs no
  registration at all, so only first-time secure hits this.

## 7. Tests to rewrite / add

Existing coverage (all `frontend-respondents/src/**`):
- **Results page:** **no test file exists** for `completed-ctrlr.ts` (only `auth-ctrlr.test.ts`,
  `used-card-ctrlr.test.ts`, `survey-ctrlr.test.ts` exist under `controllers/`). The CTA display +
  `anchor_address` gating needs a **new** `completed-ctrlr.test.ts`.
- **Routing:** no test covers `router.ts` route table; `router-entry-gates.test.ts` (162 lines) tests the
  two `resolve*Gate` helpers only. `/account` route registration + `/complete` → `/account` navigation
  would be a new test (extend `survey-ctrlr.test.ts` navigate assertions, or a new router test).
- **bootstrap.factory:** `bootstrap.factory.test.ts` (142 lines) — load-or-create + persist contract
  (mocks `generatePrivateKey`, asserts `loadBootstrapKeyFromStorage`/`BOOTSTRAP_STORAGE_KEY`). The
  wipe-E + derived-S + anchor-flag storage helpers belong alongside these assertions.
- **humanWallet.factory:** `humanWallet.factory.test.ts` (206 lines) — tests `authenticate` /
  `hasParticipatingAccount` with mocked `waap`/`oprf`/`account`/`viem`. If `authenticate` is refactored
  to return `key`, this test must be updated; new recover/re-assign + derive-persist coverage goes here.
- **storage:** `state/stores.test.ts` (312 lines) covers `slugify`, pools/user/surveys load-save-clear
  (`:96-312`). New storage helpers (`anchor_address`, derived-S key, clear-bootstrap) need additions here.
- **Contract:** `contracts/test/S3ntimentSurveyStore.test.ts` (esp. `:1270` AlreadyPoolMember) — only
  touched if a registration-semantics decision changes the contract.

**New coverage to add (Task 2):** results-page CTA shown iff `anchor_address === undefined`; `/account`
route reachable; secure-anchor → derive/register/migrate/wipe; recover/re-assign (skip registration on
AlreadyPoolMember; E2→S migration allowed to fail-safe).

---

## Implications for the Task 2 implementation

### Exists-to-reuse
- Results page + submit nav: `CompletedController` (`completed-ctrlr.ts:8`), `setSurveyListener` nav
  (`survey.ctrlr.ts:119-154`).
- Derived-leaf derive: `humanWallet.factory.ts:17-24`, `hasParticipatingAccount` (`:27`); `poolId` in
  scope via `store.activeSurvey.pool`.
- Smart-account + Pimlico paymaster write: `permissionless.simple.service.ts:33,46-50,75-84,97-118,197-199`.
- Bootstrap-E storage: `state/storage.ts:13-32`. nilDB per-leaf ops: `getUserSurveyAnswers`,
  `storeOwned`, `init`, `createNillDBSeed`, `did.ts:3`.

### Must build
- `/account` controller + route registration + results-page CTA (gated on `anchor_address === undefined`).
- Return/expose the derived S key from the human-wallet derive so it can be persisted.
- Cross-leaf E→S migration helper: two-client delete+recreate **or** an `acl/grant` wrapper (neither
  exists; both to build per RFC §11).
- Storage: `anchor_address` flag (set only after E→S rotate fully succeeds, per N1), derived-S key
  load/save, and a wipe-`bootstrapE` (`clearBootstrapKey`) helper.
- Recover/re-assign path (Case 2): skip S re-registration (revert `AlreadyPoolMember`), migrate E2→S,
  wipe E2.

### Gap needing a decision — **first-time secure S registration**
The paymaster (Pimlico) is wired and would fund any `account.write` from `/account`, but the only
registration function, `registerInPool` (`S3ntimentSurveyStore.sol:419`), is nullifier-bound — the entry
card's nullifier is spent → `NullifierAlreadyUsed` (`:454`). There is **no nullifier-less member-add**.
So a first-time E→S secure currently has **no valid registration calldata**. Decide between:
(1) a second operator card/nullifier for the S registration (extra on-chain write vs INV-2),
(2) add a `registerDerivedLeaf(poolId)` member-add to the contract (contradicts RFC §11's "add nothing
for rotation" — resolves RFC Q2 direction), or
(3) don't re-register first-time S and reconcile membership on E (contradicts the "S is member" model).
Returning recover needs **no** registration (S already member), so only first-time secure hits this.

### Exact storage keys to add / change
- **Change:** reuse `BOOTSTRAP_STORAGE_KEY='bootstrapE'` (`storage.ts:13`) for the entry leaf; add a
  `clearBootstrapKey()`/remove helper for N1 (wipe E after rotate). Nothing today removes it.
- **Add (new):** `anchor_address` (string; `undefined`==not secured) flag — `load/saveAnchorAddressFromStorage`.
- **Add (new):** derived-leaf S private key storage — `load/saveDerivedSKeyFromStorage` (mirror the
  validated 64-hex pattern of `loadBootstrapKeyFromStorage`, `storage.ts:15-26`).
- No `anchor*` key, no `secure_account`/`rotated_keys` key exists today (grep empty) — the 
  `anchor_address === undefined` predicate is net-new and drives the results CTA.
