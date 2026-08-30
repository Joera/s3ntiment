# Audit — Returning-invite recovery / second-invite merge (RFC Q2 realization)

**Date:** 2026-08-30 · **Kind:** explore (purpose=explore) · **Scope:** read-only
**Files examined:** `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, `contracts/src/testing/MockSMC.sol`,
`contracts/test/S3ntimentSurveyStore.test.ts`, `frontend-respondents/src/{bootstrap.factory.ts,humanWallet.factory.ts,router.gates.ts,state/storage.ts,controllers/{auth-ctrlr,used-card-ctrlr,survey-ctrlr}.ts,services.ts}`,
`shared/src/shared/{nillion/{nilldb.user.service.ts,did.ts},evm/permissionless.simple.service.ts,survey/survey.factory.ts,lit/actions/decrypt-for-respondent.ts,invites/card.factory.ts}`,
`nillcc-backend/src/{main.ts,survey.ctrlr.ts}`, `brain/specs/RFC-deferred-identity-persistence.md`.

## Summary

A user who was already a member of pool `P` as leaf `S` and later redeems a *second, different*
invite (`N2`) on a fresh device will have a **random bootstrap leaf `E2` registered as a NEW member**
of `P`. Because access is gated **solely by `isPoolMember`** with no per-survey/per-batch channel, the
second invite grants `E2` nothing that `S` doesn't already hold — it merely spends `N2` and creates an
orphan `E2` member/record set. The contract then **actively reverts any re-`registerInPool` of the
same leaf** (`AlreadyPoolMember`), so the model cannot re-use `registerInPool` as a merge seam; the
merge must instead be a **record-migration** (`E2 → S`) in nilDB, which today has **no production
helper** (only a same-owner `updateOwned` delete+recreate) and no on-device way to know a user has an
anchor without an auth prompt. RFC Q2 currently resolves to **revert** at the contract.

---

## 1. registerInPool on an already-member leaf

**(a) It REVERTS — `AlreadyPoolMember()`.** Membership is the last guard; re-registering a leaf already in
`poolMembers[poolId]` reverts the whole transaction, so the nullifier is **not** burned and `cardCount`
is **not** incremented (EVM revert rolls back all preceding writes).

Exact execution order in `S3ntimentSurveyStore.registerInPool` (`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:419-467`):

1. `pools[poolId].safe == address(0)` → `PoolNotFound` (L425)
2. `batches[poolId][batchId].createdAt == 0` → `BatchNotFound` (L427)
3. `batch.revoked` → `BatchRevoked` (L431) — *before* any nullifier/membership work
4. `maxCards != 0 && cardCount >= maxCards` → `BatchMaxCardsReached` (L435-436) — *before* any nullifier work
5. recover signer; `signer != batchId` → `InvalidSignature` (L453)
6. `usedNullifiers[poolId][messageHash]` → `NullifierAlreadyUsed` (L454)
7. **burn nullifier** `usedNullifiers[poolId][messageHash] = true; batch.cardCount++` (L457-458)
8. resolve identity `poolWallet = ISMC(msg.sender).owner()` (L461)
9. `poolWallet == address(0)` → `InvalidMemberAddress` (L465)
10. `poolMembers[poolId][poolWallet]` → **`AlreadyPoolMember`** (L466)
11. `poolMembers[poolId][poolWallet] = true` (L467)

So the nullifier burn (L457) precedes the membership check (L466) *in source order* — but since the
check at L466 reverts the entire call, the earlier burn at L457 is undone. Net effect: **already-member ⇒
full revert, nullifier NOT consumed.** There is no path (a)/(b)/(c) past L466; idempotent re-entry does
not exist.

**Contract test confirms:** `contracts/test/S3ntimentSurveyStore.test.ts:1270-1311` *"reverts when the
SMC owner is already a member (AlreadyPoolMember)"* — a second join with a *fresh, valid* card (`card-2`,
distinct nullifier) still reverts `AlreadyPoolMember()`. The doc-comments at
`S3ntimentSurveyStore.sol:349-352` / `369-374` echo the "before any nullifier burn or membership write"
ordering for the `BatchRevoked`/`BatchMaxCardsReached` guards.

## 2. What a nullifier/invite actually confers — nothing beyond membership

**Access is gated solely by `isPoolMember(leaf)`; there is no per-survey / per-batch authorization
keyed to nullifier/batchId/card.** Evidence:

- Contract: the only on-chain knock-on of redemption is `poolMembers[poolId][leaf] = true` (L467), plus
  the nullifier/cardCount bookkeeping (L457-458). No per-survey or per-card capability state exists —
  the storage model has no member→survey grant (`S3ntimentSurveyStore.sol:79-103` document only
  pools/surveys/batches/nullifiers/poolMembers).
- RFC §8.1 explicitly commits to this: *"`isPoolMember` remains the single access predicate — no second
  authorization path."*
- Lit decrypt gate: `shared/src/shared/lit/actions/decrypt-for-respondent.ts:19-28` checks only
  `isPoolMember(poolId, userAddress)` before `Lit.Actions.Decrypt`. Same single predicate in
  `shared/src/shared/lit/actions/decrypt.ts:12` and `user-delegation.ts:48`.
- Backend endorsement/score route re-checks `isPoolMember(poolId, signer)` (`nillcc-backend/src/main.ts:184-189`).

Therefore **redeeming invite `N2` as a fresh leaf `E2` grants nothing `S` (already a member) does not
already have.** The card's role is authentication at registration only: verify the batch-signed digest
(`card.factory.ts:95-103` → `registerInPool`), burn the nullifier once, mark the leaf a member. Per-survey
double-response prevention lives off-chain in nilDB (survey-level nullifiers), noted in the contract header
(`S3ntimentSurveyStore.sol:44`). A member's access is identical regardless of which invite got it in.

## 3. Record ownership + decryption model (E2 → S migration)

**Records are owned per-leaf (`did:key` derived from the leaf), not shared within a pool.**

- At submit the frontend derives a Nillion seed from the leaf signer and initializes the user client:
  `survey.ctrlr.ts:124-125` calls `account.createNillDBSeed()` then `nillDB.init(seed)`.
  `createNillDBSeed()` = `keccak256(toBytes(signMessage('Connect to blind computer for private responses')))`
  (`permissionless.simple.service.ts:195-199`) — deterministic for a given leaf key (RFC-6979 signing).
- The owner did is set from that client: `nilldb.user.service.ts:30-33` → `Signer.fromPrivateKey(seed)` →
  `userDidString = did:key`. Writes go through `storeOwned` → `createData` with `owner: this.userDidString`
  (`nilldb.user.service.ts:59,89`, called at `survey.ctrlr.ts:150`). The pool PKP is granted `acl`
  read+execute (`nilldb.user.service.ts:90-95`).
- `did.ts` maps a secp256k1 pubkey → `did:key` (`shared/src/shared/nillion/did.ts`). Since the seed is a
  deterministic function of the leaf private key, **re-deriving the same leaf `S` from the anchor recovers
  the same did:key and thus `S`'s existing records natively** (RFC §4.5/§4.6 recovery-by-re-derivation).

**Mechanics to attach `E2`'s new data to `S` (which already owns earlier records):** per RFC §6 there are
exactly two options, both cross-leaf and **not** satisfied by blindly re-running the live write path:

- **ACL-grant (access, owner kept = E2):** `POST /v1/users/data/acl/grant` — owner-scoped `$push` on
  `_acl` granting `S` read/write/execute on `E2`'s documents (RFC §6; audit
  `acl-grant-existing-owned-docs-2026-08-28.md`). **Not implemented anywhere in this repo** — it is a raw
  Nillion endpoint the codebase has no wrapper for (no `acl/grant` symbol under `shared/src`, no route in
  `nillcc-backend/src`). Keeps `_owner`/`_id`/history on `E2`; `S` gains access but the data stays `E2`-owned.
- **Delete+recreate (ownership move):** delete under `E2`'s signer, recreate under `S`'s signer. The
  existing `updateOwned` (`nilldb.user.service.ts:69-75`) is a **same-owner** delete+recreate (delete
  `documentId`, `createData` with the *current* client) — a genuine `E2→S` move needs **both** keys live in
  the session (two `init()`-ed clients: `E2` deletes, `S` recreates). `updateOwned` currently has **no
  production call site** (grep: only the definition), so this is unexercised seam code.
  `createNillDBSeed` exists on both the EOA path (`permissionless.simple.service.ts:197`) and the WaaP path
  (`waap.service.ts:163`), so either identity can produce its seed.

So, concretely: retiring `E2` and fully moving its records onto `S` requires **either** an ACL-grant (build
a Nillion `acl/grant` wrapper) **or** a two-client delete+recreate. Neither is implemented as a leaf→leaf
transfer today; the RFC §11 change list ("shared/nillion — record migration helper for leaf→leaf") confirms
this is **to build**.

## 4. Can entry detect a returning anchor without a start-of-flow prompt? — No.

**There is no localStorage key or heuristic that records "user has secured an anchor."** After Task 1,
deferred identity removed the auth prompt, and nothing was added to detect a previous anchor.

Storage keys that exist (`frontend-respondents/src/state/storage.ts`; `main.ts:15-19` clears only `lit-*`
on startup, preserving the keys below):

- `BOOTSTRAP_STORAGE_KEY = 'bootstrapE'` (L13) — the random bootstrap stealth-leaf **private key `E`**,
  load-or-create/persist at entry (`loadBootstrapKeyFromStorage` L15-27, `saveBootstrapKeyToStorage` L29-31;
  consumed by `ensureBootstrapKey`, `bootstrap.factory.ts:21-33`). This is a *transient leaf*, explicitly
  "NOT a durable anchor" (comment L12).
- `'surveys'` / `'pools'` (L8-9) — cached survey/pool maps.
- `'nullifier'`, `'batchId'`, `'address'` (L61-63) — the *last* card redeemed, used to detect a repeat visit
  to the same card (drives the `/used-card` gate).
- `'questions'` (`components/security-questions.ts:51`) — unrelated UI state.

**No `anchor_address`, `secure_account`, `anchor*`, or "has-persisted" flag exists.** Confirmed by grep: the
only `anchor` mentions are comments in `bootstrap.factory.ts`, `humanWallet.factory.ts`, `services.ts`.
`ensureBootstrapKey` (`bootstrap.factory.ts:24`) is `load-from-storage ?? create-and-persist` — it only
reuses the **bootstrap `E`**; it never consults any anchor reference. On a **fresh device** (the scenario)
there is no localStorage, so even the `bootstrapE` reuse path is inert.

Human-wallet anchoring (`humanWallet.factory.ts:17-25`, `authenticate`) requires an interactive WaaP
login + OPRF blind-sign — exactly the prompt deferred identity removed; it is deliberately **not** called at
entry (comments L9-16; `services.ts:72-75` no longer eagerly initializes WaaP/OPRF at startup). So there is
**no silent re-derivation seam**: recognizing a returning anchor requires either re-adding a (non-intrusive)
prompt or introducing a new on-device stored anchor-reference key — neither exists.

## 5. Any existing merge / recovery seam — No merge path; every entry registers the current leaf.

There is **no** code path that assigns an invite to an already-registered member, and **no** leaf-merge
utilitiy. Every entry path unconditionally bootstraps and registers the *current* leaf:

- Entry gates: `router.gates.ts:86-90` (`resolveSurveyGate` → `ensureBootstrapKey`); `auth-ctrlr.ts:71-78`
  (`render` → `ensureBootstrapKey` then `card.register` → `registerInPool`); `used-card-ctrlr.ts:62-64`
  ("sign in" → `ensureBootstrapKey`).
- `Card.register` (`shared/src/shared/invites/card.factory.ts:95-103`) is a one-shot
  `registerInPool` that will **revert** if the acting leaf is already a member (see §1) — so it cannot be
  repurposed as a merge/attach step for an existing member.

What exists to *reuse* vs. *build* (see full list in section below):

- **Reusable:** the leaf-signer swap primitive `updateSignerWithKey` (`permissionless.simple.service.ts:58-63`,
  called from `bootstrap.factory.ts:26` / `humanWallet.factory.ts:22`); per-leaf `did:key` derivation and
  deterministic Nillion seed (`createNillDBSeed`); `NillDBUserService.init(seed)` + `getUserSurveyAnswers`
  (`nilldb.user.service.ts:40-56`) to read a leaf's existing records; the same-owner delete+recreate
  `updateOwned` (`nilldb.user.service.ts:69-75`).
- **To build:** any `E2→S` record migration — ACL-grant wrapper and/or a two-client delete+recreate; a
  stored anchor-reference so entry can detect a returning anchor; the on-chain idempotent re-entry semantics
  (contract change) *if* instead of reverting we wanted `registerInPool` itself to absorb the re-derivation.
  Note the RFC §11 change list already earmarks "record migration helper for leaf→leaf" and "contract
  change only if Q2 demands idempotent re-registration" — both still unimplemented.

## Implications for the second-invite merge design

**Reuse:**
- The re-derivation machinery (RFC §4.5/§4.6): `S` re-derives to the same leaf key → same did:key →
  `S`'s prior records and membership are recovered with **no contract write** (the revert in §1 makes that
  moot anyway — `S` must not be re-registered because it's already a member).
- `updateSignerWithKey` as the mechanism to switch the acting leaf `E2 → S` and re-`init` the nilDB client.
- `getUserSurveyAnswers` and `storeOwned`/`updateOwned` as the raw read/delete/recreate building blocks.
- `createNillDBSeed` (both EOA and WaaP variants) for deriving the per-leaf Nillion identity.

**Must build:**
- A genuine **cross-leaf record migration** (nothing transfers owner across leaves today):
  (i) ACL-grant (`acl/grant`, not wrapped in this repo), and/or (ii) two-client delete+recreate produced
  while both `E2` and `S` keys are live in the session.
- A stored **anchor-reference / "has-anchor" signal** so entry can silently re-derive `S` instead of always
  bootstrapping a random `E` — today nothing in localStorage or the entry gates can detect a returning
  anchor without re-adding an auth prompt (Q4).
- (Alternative, only if merge-through-the-contract is wanted) idempotent/absorbing `registerInPool`
  semantics — a contract change not present today.

**RFC Q2 resolution the code currently implies:** **Revert.** The contract (`S3ntimentSurveyStore.sol:466`)
and its test (`S3ntimentSurveyStore.test.ts:1270`) make a newly-registered leaf that is already a member a
hard revert, not an idempotent re-entry. Merge therefore cannot be a contract concern — it is a
nilDB record-migration concern, and that path does not yet exist. This is consistent with RFC §6/§11:
"add nothing for rotation … revisit only if Q2 demands idempotent re-registration," and "registerInPool
remains the single registration."
