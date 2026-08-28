# SPEC-00 — s3ntiment system contract

> Always load this file first, in any agent session touching this repo. It is the map of the maps:
> what the system is, what order to read the other specs in, the principles every decision is
> measured against, the invariants that hold across every component, the open gaps, and the index
> of decision records.
>
> **Sources:** repomix share of the working tree (`shared`, `frontend-organiser`,
> `frontend-respondents`, `contracts`, `protocol`, `nillcc-backend`) + `brain/code-map/MAP.md` +
> project chat history Oct 2025 – Jul 2026. Decision records (DR-*) are reconstructed from that
> history; each carries its own status so a reader can tell current design from abandoned paths.
>
> **Why the DRs are here at all:** the specs describe the code as it is. The DRs exist so nobody —
> human or agent — re-walks a path we already walked and abandoned. If a change you're about to
> make matches a DR marked SUPERSEDED, REJECTED or EXPLORED, stop and read why before proceeding.

## What this system is

s3ntiment is a privacy-preserving survey/feedback platform. Respondents answer surveys without the
organiser — or s3ntiment itself — seeing an individual's raw response tied to their identity; the
organiser gets aggregated results. Three technologies do the privacy work together:

- **On-chain registry (Base, `S3ntimentSurveyStore.sol`)** — proves pool membership with exactly
  one write per respondent per pool, and nothing else. Survey participation is never on-chain.
- **Lit Protocol (Chipotle)** — encrypts survey configs; each pool's Lit Actions gate decryption on
  an on-chain condition (pool-safe + Safe-signer for the owner path, pool membership for the
  respondent path).
- **Nillion nilDB (`@nillion/secretvaults`)** — stores individual responses, with NUC delegation
  scoping who may write and read what.

A pool is a respondent registry shared by one or more surveys (a "panel"). A survey belongs to
exactly one pool. Respondents join a pool once, via a QR card carrying a signed nullifier; after
that, participation is entirely off-chain.

## Governing principles (the four pillars)

Settled in the positioning work (Mar 2026); the yardstick every DR is measured against. Not
marketing copy — they decide architecture.

1. **Privacy by design** (GDPR Art. 25 as the deliberate hook) — three layers: identity is yours
   alone; access is enforced by math, not people; data is never whole in one place. Recurring
   phrasing: *data minimisation as architecture, not as policy.*
2. **Data sovereignty / not a platform** — infrastructure, not platform. The **walk-away test** is
   the operative check: *can a pool take its keys and data, stop using s3ntiment entirely, and keep
   operating?* If a design choice makes the answer "no", it fails this pillar.
3. **One invitation, one unique participation** — sybil resistance without identity.
4. **Continuous feedback** — surveys that run on (the "barometer" model), answers editable when
   people change their minds; not one-shot polls.

**The honest caveat, kept deliberately:** the walk-away test passes on code (open source) but not
cleanly on infrastructure — frontends need re-hosting, the Nillion backend needs redeploying, and
Nillion is a company that could revoke API access. This caveat is stated publicly on purpose;
transparency about it was judged more credible than a clean pitch. Don't quietly drop it.

## Reading order

1. **SPEC-00** (this file).
2. **SPEC-contracts** — the one on-chain trust boundary everything defers to.
3. **SPEC-shared** — `@s3ntiment/shared`: crypto/privacy plumbing for both frontends + backend.
4. **SPEC-nillcc-backend** — the Express API; holds the builder key, issues delegations.
5. **SPEC-frontend-organiser** — creator app. ⚠ Skimmed only.
6. **SPEC-frontend-respondents** — respondent app. ⚠ Skimmed only.
7. **SPEC-protocol** — Naga-era Lit scripts; see DR-L1, vestigial.

(`website` and `branding` are deliberately unspecced.)

## Cross-cutting invariants

- **INV-1 — Respondent data ownership is the goal; the live write path does not yet deliver it.**
  Design intent (and public promise): `owner: userDidString`, builder granted `read`+`execute`,
  never `write`. `NillDBUserService.storeOwned` implements exactly that. But the **live path is
  `storeStandard`**, where the respondent POSTs to the backend and the *builder* writes on their
  behalf into a builder-owned collection. See **DR-N2** — the largest gap between pillars and
  implementation, and a deliberate temporary concession to Nillion's SDK, not an oversight.
- **INV-2 — One on-chain write per respondent per pool, ever.** `registerInPool()` burns a nullifier
  and records membership once. Everything downstream derives off-chain from that one fact.
- **INV-3 — Identity resolves through the pool wallet EOA, never a master identity.** WaaP mints a
  fresh EOA per pool; Lit conditions and nilDB DIDs key off that EOA/DID. Cross-pool correlation
  impossible by construction; cross-survey correlation *within* a pool is intended (panel model).
- **INV-4 — Pool/survey mutation authority is enforced on-chain, not application-side.** The contract
  checks `msg.sender == pool.safe` (or bootstraps a new pool with the caller as Safe). Backend
  controllers rely on this rather than checking themselves — see GAP-1.
- **INV-5 — Two decrypt paths, two on-chain conditions, one action each.** Owner: `isPoolSafe` AND
  `isOwner`. Respondent: `isPoolMember`. Conditions are baked into action source at generation time
  (DR-L4), not passed at runtime.
- **INV-6 — Scoring answer keys never reach the respondent decrypt path.** `stripScoring()` splits
  the config into an owner variant (with scoring) and a respondent variant (without). The scoring
  map goes on a **third, builder-only ECIES channel** — see DR-S1, explicitly temporary.
- **INV-7 — `shared` has bundler-specific entry points; the wrong one breaks the build.**
  `.` / `./dev` / `./browser` / `./node` / `./assets` / `./components`. No single entry is safe for
  every consumer.
- **INV-8 — Input validation is not a trust boundary.** The real guarantees are the on-chain gate,
  the in-action check inside the Lit TEE, and the nilDB ACL. Express-level checks are fail-fast UX.

## Decision record index

| ID | Subject | Status |
|---|---|---|
| DR-C1 | Card signing: ephemeral batch wallet vs platform key vs per-card | current |
| DR-C2 | `batchId` **is** the batch wallet address | current |
| DR-C3 | Batches scoped to pool, not survey | current (supersedes survey-scoped) |
| DR-C4 | Pool model replaces standalone-survey model | current |
| DR-C5 | Pool created implicitly by first `createSurvey` | current, with drift (GAP-9) |
| DR-C6 | SMC indirection retained for gas abstraction | current |
| DR-C7 | No events emitted | current |
| DR-C8 | Survey-level nullifiers live in nilDB, not on-chain | current |
| DR-I1 | WaaP (Human Wallet) as wallet/identity provider | current |
| DR-I2 | Human Network personal-data nullifier | SUPERSEDED by DR-C1 |
| DR-I3 | Deferred WaaP login (card-derived signer first) | EXPLORED, not adopted |
| DR-L1 | Naga → Chipotle: ACCs replaced by in-action checks | current |
| DR-L2 | No SDK — raw HTTP against the Chipotle REST API | current |
| DR-L3 | One group + one PKP per pool, pool-owned (walk-away test) | TARGET; SaaS posture live |
| DR-L4 | Pool constants baked into action source at generation | current |
| DR-N1 | Builder key pays; builder never ACL grantee for write | current (intent) |
| DR-N2 | Owned collections → standard collections | current, TEMPORARY, contradicts INV-1 |
| DR-N3 | Delegation without ownership is a "convenience trap" | resolved on paper, drifted (GAP-10) |
| DR-S1 | Answer key encrypted to builder DID (ECIES) | TEMPORARY, contradicts pillar 2 |

Full text lives in the relevant component spec.

## Gap register

> **Verified 2026-08-27** against HEAD `01d95773` (`brain implant`). GAP-7 resolved; GAP-2/GAP-3
> scope widened; GAP-9/GAP-10 confirmed with refinements; GAP-11..GAP-17 newly added. Full evidence:
> `brain/audits/gap-verification-2026-08-27.md`.

- **GAP-1 (real, unresolved) — Commented-out ownership verification in `survey.ctrlr.ts`.**
  `create`/`update` carry a comment claiming authorization is enforced on-chain, but the backend
  functions have no caller-identity check; `verifyPoolOwner`/`verifyOwnership` are written and fully
  commented out. Safety depends on where the Safe-executed tx sits in the flow (Q2).
- **GAP-2 (real, unresolved, WORSE than first described) — `getUserWriteDelegation` issues a write
  delegation with no membership check and NO `.policy()` at all.** Verified 2026-08-27: the
  `POST /surveys/:id/delegation` route (`main.ts:130-133`) has no signature/membership check, and
  the delegation grants any DID a 1-hour unrestricted `nil.db.data.create` — `surveyId` is only used
  in a `console.log` (`nildb.builder.service.ts:120-134`). Contrast `getOwnerReadDelegation`
  (`:137-147`), which *does* scope via `.policy([["==", ".args.collection", surveyId]])`. Partly
  masked today because the live write path is `storeStandard` (DR-N2), where the backend writes and
  *does* check membership — but the endpoint is still exposed.
- **GAP-3 (real, security, BROADER than first described) — Hardcoded fallback secrets.** Verified
  2026-08-27: `pkpId` `0x7598155069ba02e7dd87afc0c2b5e587b34b2379` is used **unconditionally** in
  backend `create` (`survey.ctrlr.ts:29,46-47`), plus a fallback usage key literal
  (`survey.ctrlr.ts:31-35`, `main.ts:254-255`). Also present beyond the register:
  `shared/src/shared/survey/survey.factory.ts:31,85` (both decrypt paths),
  `frontend-organiser/src/controllers/new.ctrlr.ts.ts:79-81`, and
  `frontend-organiser/src/controllers/survey.ctrlr.ts:189` (hardcoded poolId). Introduced at HEAD
  `4cf68f413`. Dev scaffolding left in after `PoolController.create` was built.
- **GAP-4 (real, security-adjacent) — Committed private key in `protocol/scripts/fund-myself.ts`.**
- **GAP-5 (design gap, acknowledged in code) — `PoolController.update` is an empty stub** whose body
  is the comment "but with what authority???". No key rotation, no adding actions to an existing
  group. Blocked on DR-L3: the answer to "what authority" is *the pool's Safe*, i.e. the sovereign
  posture not yet implemented.
- **GAP-6 — RESOLVED (was: two Lit SDK generations).** Naga is **deprecated**, Chipotle is current
  (DR-L1). `protocol/` is therefore **vestigial Naga-era tooling**, as is `shared/lit/accs.ts` (ACCs
  were the Naga access mechanism; Chipotle enforces inside action code). Action: delete or quarantine
  both; do not reintroduce ACC-style gating.
- **GAP-7 — RESOLVED / STALE (was: `nillcc-backend` vs `nilcc-backend` naming drift).** Verified
  2026-08-27: directory, package name (`@s3ntiment/nillcc-backend`) and dev script all use `nillcc`;
  `git grep "nilcc"` finds only `.pi/skills/nillion.md` (unrelated Nillion product doc) and this
  register entry. No code drift remains — close the entry.
- **GAP-8 (partially verified 2026-08-27, specs still shallow) — both frontends were not read
  deeply.** Their specs are file-tree sketches, but the underlying code is real and wired: organiser
  create/update/results flow (`new.ctrlr.ts.ts`, `survey.ctrlr.ts`) and respondents
  WaaP+OPRF+card-register+decrypt+submit flow (`auth-ctrlur.ts`, `auth.factory.ts`, `survey.ctrlr.ts`)
  all exist. The specs can be upgraded from "file-tree sketch" to "verified at these call sites";
  `frontend-respondents/lit-actions/decrypt-signature.js` is confirmed vestigial (unreferenced).
- **GAP-9 (drift, confirmed 2026-08-27) — `createSurvey` authority is stricter in code than in the
  design.** The Mar 2026 design (DR-C5) had subsequent surveys creatable by *any Safe signer* via
  `ISafe(pool.safe).isOwner(msg.sender)`; the deployed contract requires
  `pools[poolId].safe == msg.sender` (`S3ntimentSurveyStore.sol:160`), i.e. a full Safe-executed tx
  per survey. Nuance: the `isOwner`-for-signers model *survives* in the decrypt Lit action
  (`shared/.../lit/actions/decrypt-for-owner.ts:26-32` checks `safe.isOwner(userAddress)`) even
  though the contract dropped it for `createSurvey` — relevant to Q3. Deliberate tightening or lost
  in a rewrite? It materially changes organiser UX.
- **GAP-10 (drift, confirmed 2026-08-27) — collection ownership contradicts DR-N3.**
  `createSurveyCollection` (`nildb.builder.service.ts:60-70`) hardcodes `owner:
  this.builderDid!.didString`, so the *builder* owns every survey collection. Two refinements:
  (1) the third parameter `surveyOwnerDid` is **ignored dead code** — the body never reads it; the
  call site (`survey.ctrlr.ts:40-41`) passes the builder DID anyway, and the collection type is
  `"standard"`. (2) the "owned-collection API unavailable" rationale is **stale**: the repo pins
  `@nillion/secretvaults@3.0.0` (root override), and `storeOwned`/`updateOwned`
  (`nilldb.user.service.ts:74-129`) already implement the owned-collection write against that SDK —
  reinstating the owned path is a wiring change, not blocked on the SDK. (Note:
  `frontend-respondents/package.json` still declares the old SDK 0.1.7/0.1.1; the root override
  rewrites it to 3.0.0/2.0.1.) Combined with DR-N2, current state is builder-owned collection +
  builder-written data — the weakest point in the architecture relative to pillar 2.
- **GAP-11 (real, security — NEW 2026-08-27) — Unguarded aggregated-results endpoint.**
  `POST /surveys/:id/results` (`main.ts:220-227`) has no signature, membership or owner check despite
  its comment "Get aggregated survey results (owner only)"; `findSurveyResults` accepts a `signature`
  arg but the caller passes `""` (`nildb.builder.service.ts:157`). Anyone who can reach the backend
  can dump tallied results for any survey. Arguably the most exposed endpoint in the codebase.
- **GAP-12 (real, security — NEW 2026-08-27) — Hardcoded Alchemy API key baked into Lit Action
  sources.** `shared/src/shared/lit/actions/decrypt-for-owner.ts:3`,
  `decrypt-for-respondent.ts:15`, `decrypt.ts:4` embed
  `https://base-mainnet.g.alchemy.com/v2/NFOkRqUo2swIC9g5tRJ7c` in the action source that
  `PoolController.create` registers on Lit. Committed RPC key in tracked code.
- **GAP-13 (real — NEW 2026-08-27) — Hardcoded dev-pool bypass threaded through backend + frontends.**
  poolId `5f6b3f9b-5676-4927-b11a-0b1f02344cdf` appears in `main.ts:254` (fallback usage key),
  `frontend-organiser/src/controllers/survey.ctrlr.ts:189` ("should be added or selected at import"),
  and `new.ctrlr.ts.ts:79-81` (reuse existing PKP + `groupId = 22` instead of minting). A hardcoded
  production-pool shortcut in the create path — an extension of GAP-3.
- **GAP-14 (real — NEW 2026-08-27) — Create/update HTTP endpoints are completely unauthenticated.**
  `POST /surveys` (`main.ts:78-84`) and `PUT /surveys/:id` (`:99-111`) have no `verifyMessage` and no
  middleware; the `verifySignature` middleware (`:50-60`) is defined but attached to no route (dead
  code, cf. DR-B1). Answers Q2: the backend call precedes the Safe tx.
- **GAP-15 (minor bug — NEW 2026-08-27) — Submit error-string mismatch.** Backend returns
  `'UNAUTHORIZED'` (`main.ts:171`); the respondents frontend checks `r.error == "UNAUTHORISED"`
  (`frontend-respondents/src/controllers/survey.ctrlr.ts:131`) — the error branch never fires.
- **GAP-16 (minor — NEW 2026-08-27) — Pool usage keys stored in plaintext on disk.**
  `shared/src/node/lit.key-storage.ts` writes each pool's usage key to `.data/pool-keys/<poolId>.json`
  unencrypted. Runtime storage, arguably acceptable for a backend, but worth noting.
- **GAP-17 (minor — NEW 2026-08-27) — Vestigial `nillai.service.ts`.** `nillcc-backend/src/services/
  nillai.service.ts` is entirely commented out (parked, per DR-B2) — dead code, not a secret.

## Open questions

- **Q1 — CLOSED.** (Was: is `protocol/` still live?) No; Naga is deprecated. See GAP-6.
- **Q2 — ANSWERED 2026-08-27.** The backend call *precedes* the Safe-executed tx: the organiser
  frontend POSTs `/api/surveys` then `safe.write('createSurvey')` (and PUTs then
  `safe.write('updateSurvey')`). The backend does unauthenticated work (re-encrypt/upload to IPFS)
  that the on-chain gate never sees — see GAP-14. (GAP-1)
- **Q3 (open)** — Was the `isOwner`-for-signers path deliberately dropped or lost? (GAP-9)
- **Q4 (open, but the blocker is gone)** — Is `storeOwned` to be reinstated, or has the
  standard-collection model become the design? The "owned collections haven't stabilised" rationale
  no longer holds: `@nillion/secretvaults@3.0.0` exposes the API `storeOwned` already implements
  (GAP-10). Reinstating is now a deliberate wiring decision, not an SDK constraint. (DR-N2, GAP-10)

## Open tasks

- Wire or delete the commented-out ownership checks (GAP-1).
- Add a membership check to `getUserWriteDelegation` (GAP-2).
- Remove/env-gate the hardcoded fallback usage key and `pkpId` (GAP-3).
- Confirm and rotate/remove the key in `fund-myself.ts` (GAP-4).
- Delete or quarantine `protocol/` and `shared/lit/accs.ts` as Naga vestiges (GAP-6).
- Decide pool-update authority — blocked on DR-L3 (GAP-5).
- Resolve the two ownership drifts (GAP-9, GAP-10) before they harden into design.
- Real read-pass on both frontends (GAP-8).
- Gate `/surveys/:id/results` behind an owner/membership check (GAP-11).
- Remove the Alchemy RPC key from Lit action sources (GAP-12).
- Remove the hardcoded dev-pool bypass from the organiser create path (GAP-13).
- Authenticate the create/update HTTP routes (GAP-14).
- Fix the UNAUTHORIZED/UNAUTHORISED spelling mismatch (GAP-15).

## Per-component spec template

1. **What it is** — one paragraph, role in the system.
2. **Entry points** — how it's built/bundled/run, and by whom.
3. **Key files** — the ones carrying real logic.
4. **Shared surface consumed** — which `@s3ntiment/shared` exports, via which entry point.
5. **Invariants specific to this component.**
6. **Decision record** — DR entries: *When / Decision / Why / Rejected / Status*, plus a drift note
   where code and decision disagree.
7. **Gaps / open questions**, cross-referenced to SPEC-00 by ID.
8. **⚠ UNVERIFIED** on any section not backed by a source read.