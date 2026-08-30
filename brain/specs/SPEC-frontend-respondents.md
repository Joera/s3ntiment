# SPEC-frontend-respondents — `frontend-respondents`

> Verified 2026-08-27 at the auth + submit call sites (`survey.ctrlr.ts`, `pool.store.ts`,
> `state/storage.ts`, `state/store.ts`). OPRF internals, the card-scan UI and
> `lit-actions/decrypt-signature.js` remain ⚠ UNVERIFIED.

## What it is

The respondent-facing web app: scan a QR invite card, authenticate (WaaP email/phone login +
presumably OPRF, per `shared/browser/oprf`), answer a survey privately, see a completion/used-card
view. Vite build, `src/main.ts` entry, ~2.3k LOC.

## Entry points

- `src/main.ts`, `index.html`, `vite.config.js`.
- `lit-actions/decrypt-signature.js` — a Lit Action **checked into this app directly**, separate
  from the templated actions in `shared/lit/actions/*`. ⚠ Not read — worth checking whether this
  duplicates or replaces `getDecryptForRespondentAction` (see Gaps below).

## Key files (verified call sites)

- `src/controllers/survey.ctrlr.ts` — the **owned-collections submit flow** (merge): on
  `survey-complete` it derives a nilDB seed, signs `s3ntiment:submit`, POSTs
  `{ userDid, signature, userAddress, poolId, pkpId, pkpDid }` to
  `/api/surveys/:id/delegation`, and calls `NillDBUserService.storeOwned(docId, survey,
  pool.config, answers, surveyId, delegation)` — the PKP-signed delegation lets the respondent's
  own DID write the record with the pool PKP as ACL grantee (INV-1). Survey config is fetched via
  `fetchAndDecryptSurveyWithRespondent(…, this.pool.config, …)`.
- `src/state/pool.store.ts` — **`PoolStore` (NEW)**: an observable store of `Pool[]` persisted to
  `localStorage` (`pools` key), with `get`/`add`/`remove`/`clear`/`subscribe`. The respondent app
  now resolves pool identity (including `config.pkpId`/`pkpDid`) from this store instead of a
  hardcoded pool.
- `src/state/storage.ts` — `loadPoolsFromStorage`/`savePoolsToStorage` for the `PoolStore`.
- `src/state/store.ts` — root store; now owns a `PoolStore` and exposes `getPool(id)`.
- `src/controllers/auth-ctrlr.ts` — WaaP auth + card registration; post-merge the `VITE_PROD`
  bypass for non-participants was removed (membership is always enforced).
- `src/components/security-questions.ts`, `survey-questions.ts` — the actual answer-taking UI.
- `src/auth.factory.ts`, `src/ux.factory.ts` — WaaP login + `createNillDBSeed()` wiring. ⚠ not
  read this pass.

## Shared surface consumed

Verified at the submit call site: root `@s3ntiment/shared` (`Survey`, `Pool`,
`NillDBUserService`, `createUserDataObject`, `fetchAndDecryptSurveyWithRespondent`, `isScored`)
plus `@s3ntiment/shared/browser` (`WaapService`, OPRF) per the entry-point contract in SPEC-shared.

## Invariants specific to this component

- **`storeOwned` is the live write path** (INV-1): the respondent's own nilDB DID owns the record;
  the pool PKP DID is the ACL grantee with `read`+`execute`, never `write`.
- The respondent signs a fixed message (`s3ntiment:submit`) — the pool-scoped membership check
  happens inside the `user-delegation` Lit Action (INV-5), not in the frontend.
- Pool identity (pkpId/pkpDid) comes from the `PoolStore`/pool config, never a hardcoded literal.

---

# Decision record

### DR-F1 — WaaP login happens before the first survey
**When:** Mar 2026.
**Decision:** the respondent authenticates with WaaP (email/phone) as part of the card-scan flow,
before answering.
**Why / what was rejected:** see **DR-I3** in SPEC-shared — deferring WaaP until after the first
survey was explored in detail and dropped, because deriving the first-visit signer from the card
nullifier turns a photographed card into a stolen key, and because linking the card identity to the
later WaaP identity requires storing a binding that leaks either on-chain or into nilDB.
**Status:** current. If first-run friction resurfaces, read DR-I3 before re-proposing.

### DR-F2 — Invitation medium: physical cards *and* personal email invitations
**When:** Dec 2025.
**Decision:** support both a printed card handed out in a place, and a personal email carrying a
one-time code.
**Why:** they produce different, both-valid cohorts. A physical card at a venue creates a
**time-and-place bound cohort** ("people who were at this exhibition") — the physical distribution is
itself the quality control and the exclusivity is tangible. An email invitation creates a
**criteria-bound cohort** ("members", "past attendees", "contributors") — lower friction, targeted,
supports reminders and re-invitation, and scales without logistics. The privacy architecture is
unchanged either way: the invitation proves cohort membership without revealing identity, and the
nullifier prevents reuse.
**Status:** current. The distinguishing claim against open-link tools is *cohort membership provable
but anonymous* — worth keeping straight in copy.

## Gaps / open questions

- `lit-actions/decrypt-signature.js` vs `shared/lit/actions/decrypt-for-respondent.ts` — possible
  duplication. Under DR-L4 each pool's action is generated with its constants baked in, so a static
  checked-in action is suspicious: either it predates DR-L4 or it serves a different purpose. Diff
  them before assuming equivalence.
- OPRF internals and the card-scan UI remain ⚠ UNVERIFIED (GAP-8, SPEC-00).
- **GAP: `SurveyController` pool-config chicken-and-egg / first-render reachability (2026-08-28, PR #10).**
  `render()` needs `poolConfig.pkpId` to call `fetchAndDecryptSurveyWithRespondent` (which passes it into
  `services.lit.decrypt`), but the pool config (`pkpId`/`pkpDid`) is only available *after* the survey is
  decrypted — it lives on the decrypted `EncryptedConfig.config`, the same field the backend reads as
  `surveyConfig.config`. PR #10 fixed the immediate bug (`SurveyController.this.pool` was never assigned, so
  the success path always threw on `this.pool!.config`; now `this.poolConfig` is plumbed out of the decrypted
  `config`), but on a **fresh controller's first `render()`** `this.poolConfig` is still `undefined` when
  forwarded into the decrypt fn, which dereferences `poolConfig.pkpId` and throws — the first render still
  lands in `renderWarning` until a subsequent render populates `poolConfig`.
  ⚠ There is ALSO a spec-vs-code discrepancy: this spec (§Key files) and the code comment say pool identity /
  `pkpId`/`pkpDid` come from the **`PoolStore`** (`store.getPool(...).config`), but that store has **no
  `setPool`/populate callers anywhere** in `frontend-respondents`, so `getPool()` always returns `undefined` —
  and the controller never reads it. The config is not sourced before first decrypt and not available from
  the store in practice. Likely to surface when the complete flow is exercised in a live env (the user
  remembers being confused by exactly this before).
  **Resolution direction (TBD):** source `poolConfig` before the first decrypt (e.g. a prior pool fetch that
  populates `PoolStore`, or having the shared decrypt fn tolerate a missing `pkpId` on first call), and/or
  reconcile the PoolStore-population gap. Not blocking the PR #10 test tranche; to-be-done.
