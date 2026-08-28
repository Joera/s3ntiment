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
>
> **Verified 2026-08-27 post-merge** against `merge-owned` HEAD (owned-collections merge into main,
> PR #2). GAP-2/GAP-3/GAP-10/GAP-13 resolved by the merge; DR-L3/DR-N1/DR-N3 now current;
> DR-N2 superseded; new GAP-11..GAP-19 added (incl. the GAP-19 delegation-route mismatch that
> blocks the live submit path). This file and all component specs were rewritten to match the
> merged tree — read the DR statuses, not the old prose, if you remember a different state.

## What this system is

s3ntiment is a privacy-preserving survey/feedback platform. Respondents answer surveys without the
organiser — or s3ntiment itself — seeing an individual's raw response tied to their identity; the
organiser gets aggregated results. Three technologies do the privacy work together:

- **On-chain registry (Base, `S3ntimentSurveyStore.sol`)** — proves pool membership with exactly
  one write per respondent per pool, and nothing else. Survey participation is never on-chain.
- **Lit Protocol (Chipotle)** — encrypts survey configs; each pool's Lit Actions gate decryption on
  an on-chain condition (pool-safe + Safe-signer for the owner path, pool membership for the
  respondent path).
- **Nillion nilDB (`@nillion/secretvaults`)** — stores individual responses in **PKP-owned
  collections**: each pool's PKP (minted at pool setup) is registered as that pool's nilDB builder
  and signs the NUC invocations/delegations that scope who may write and read what (DR-N3, INV-9).

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
4. **SPEC-nillcc-backend** — the Express API; mints per-pool PKPs, registers them as nilDB
   builders, issues PKP-signed delegations.
5. **SPEC-frontend-organiser** — creator app. Verified at the create/results call sites (2026-08-27).
6. **SPEC-frontend-respondents** — respondent app. Verified at the auth/submit call sites (2026-08-27).
7. **SPEC-protocol** — Naga-era Lit scripts; see DR-L1, vestigial.

(`website` and `branding` are deliberately unspecced.)

## Cross-cutting invariants

- **INV-1 — Respondent data ownership is delivered on the live write path.** `storeOwned` is the
  live respondent submission path: the record is written with `owner: userDidString` (the
  respondent's nilDB DID), and the ACL grants the pool's **PKP DID** `read`+`execute`, never
  `write`. Because the PKP is the collection owner (DR-N3), the platform builder key holds no write
  authority over respondent data. See DR-N2 (superseded) and DR-N3 (now current).
- **INV-2 — One on-chain write per respondent per pool, ever.** `registerInPool()` burns a nullifier
  and records membership once. Everything downstream derives off-chain from that one fact.
- **INV-3 — Identity resolves through the pool wallet EOA, never a master identity.** WaaP mints a
  fresh EOA per pool; Lit conditions and nilDB DIDs key off that EOA/DID. Cross-pool correlation
  impossible by construction; cross-survey correlation *within* a pool is intended (panel model).
- **INV-4 — Pool/survey mutation authority is enforced on-chain, not application-side.** The contract
  checks `msg.sender == pool.safe` (or bootstraps a new pool with the caller as Safe). Backend
  controllers rely on this rather than checking themselves — see GAP-1.
- **INV-5 — Per-pool Lit actions, conditions baked in at generation time.** Each pool provisions six
  action types — `encrypt`, `decrypt-owner`, `decrypt-respondent`, `get-public-key`,
  `owner-invocation`, `user-delegation` — each a generated string closed over the pool's constants
  (DR-L4). Owner-gated actions (`decrypt-for-owner`, `owner-invocation`) check `isPoolSafe` AND Safe
  `isOwner`; respondent-gated actions (`decrypt-for-respondent`, `user-delegation`) check
  `isPoolMember`. Conditions are baked into source at generation time, never passed at runtime.
- **INV-6 — Scoring answer keys never reach the respondent decrypt path.** `stripScoring()` splits
  the config into an owner variant (with scoring) and a respondent variant (without). The scoring
  map goes on a **third, builder-only ECIES channel** — see DR-S1, explicitly temporary.
- **INV-7 — `shared` has bundler-specific entry points; the wrong one breaks the build.**
  `.` / `./dev` / `./browser` / `./node` / `./assets` / `./components`. No single entry is safe for
  every consumer.
- **INV-8 — Input validation is not a trust boundary.** The real guarantees are the on-chain gate,
  the in-action check inside the Lit TEE, and the nilDB ACL. Express-level checks are fail-fast UX.
- **INV-9 — The pool's PKP is the nilDB collection owner and builder for that pool.** The PKP is
  registered as a nilDB builder at pool setup (`/builder/register`) and signs every NUC invocation
  for its pool's collections/queries (create collection, create/execute/read the aggregation
  query). The platform builder key is demoted to the scoring ECIES channel (DR-S1) and
  `initBuilder`; it no longer owns or writes respondent data.
- **INV-10 — One PKP per pool, pool-owned (DR-L3 implemented).** `PoolController.create` mints a
  fresh PKP, registers six actions, creates a Lit group permitting exactly that PKP + those action
  CIDs, and mints a pool-scoped usage key. The walk-away posture is now the live posture.

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
| DR-L3 | One group + one PKP per pool, pool-owned (walk-away test) | current (implemented) |
| DR-L4 | Pool constants baked into action source at generation | current |
| DR-N1 | Builder key pays; builder never ACL grantee for write | current (realized) |
| DR-N2 | Owned collections → standard collections | SUPERSEDED (owned collections live) |
| DR-N3 | Delegation without ownership is a "convenience trap" | current (resolved in code) |
| DR-S1 | Answer key encrypted to builder DID (ECIES) | TEMPORARY, contradicts pillar 2 |

Full text lives in the relevant component spec.

## Gap register

> **Verified 2026-08-27** against HEAD `01d95773` (`brain implant`). GAP-7 resolved; GAP-2/GAP-3
> scope widened; GAP-9/GAP-10 confirmed with refinements; GAP-11..GAP-17 newly added. Full evidence:
> `brain/audits/gap-verification-2026-08-27.md`.

- **GAP-1 (real, unresolved) — Commented-out ownership verification in `survey.ctrlr.ts`.**
  `create`/`update` carry a comment claiming authorization is enforced on-chain, but the backend
  functions have no caller-identity check; `verifyPoolOwner`/`verifyOwnership` are written and fully
  commented out. Post-merge GAP-14 makes the exposure concrete: the Express endpoints are
  unauthenticated and the backend call precedes the Safe tx (Q2).
- **GAP-2 — RESOLVED (was: `getUserWriteDelegation` issues a write delegation with no membership
  check).** The old `NilDBBuilderService.getUserWriteDelegation` (no membership check, no policy)
  is **commented out**; the live delegation path is now `NillionPkpClient.getUserWriteDelegation`,
  which runs the `user-delegation` Lit Action. That action verifies the `s3ntiment:submit`
  signature *and* `isPoolMember(poolId, userAddress)` inside the TEE before the PKP signs the
  delegation — the membership gate moved from the backend into the action (INV-5).
- **GAP-3 — RESOLVED (was: hardcoded fallback secrets).** The unconditional `pkpId`
  (`0x7598155069…`), the dev-pool `poolId` (`5f6b3f9b-…`), and the usage-key fallback
  (`MCKlyMki/…`) are all removed. `survey.ctrlr.ts` reads `pkpId`/`pkpDid` from
  `surveyConfig.config`; `/lit/usage-key` and `create` fetch the usage key from `LitPoolKeys` with
  no fallback literal. `grep` for all three strings returns nothing in `*.ts`/`*.tsx`.
- **GAP-4 (real, security-adjacent) — Committed private key in `protocol/scripts/fund-myself.ts`.**
  Unchanged by the merge; still open.
- **GAP-5 (design gap, acknowledged in code) — `PoolController.update` is an empty stub** whose body
  is the comment "but with what authority???". No key rotation, no adding actions to an existing
  group. The authority answer (the pool Safe / its PKP) is now provisioned per pool (DR-L3), so the
  stub is unblocked in principle but still unimplemented.
- **GAP-6 — RESOLVED (was: two Lit SDK generations).** Naga is **deprecated**, Chipotle is current
  (DR-L1). `protocol/` is therefore **vestigial Naga-era tooling**, as is `shared/lit/accs.ts` (ACCs
  were the Naga access mechanism; Chipotle enforces inside action code). Action: delete or quarantine
  both; do not reintroduce ACC-style gating.
- **GAP-7 — RESOLVED (was: `nillcc-backend` vs `nilcc-backend` naming drift).** Directory, package
  name (`@s3ntiment/nillcc-backend`) and dev script all use `nillcc`; no code drift remains.
- **GAP-8 — PARTIALLY RESOLVED (was: both frontends not read deeply).** The organiser create/results
  flow (`new.ctrlr.ts.ts`, `survey.ctrlr.ts`) and the respondent auth/submit flow
  (`survey.ctrlr.ts`, `pool.store.ts`) are now read and spec'd (2026-08-27). Still unverified:
  batch-card derivation (DR-O1), OPRF internals, and the `lit-actions/decrypt-signature.js`
  duplication question in `frontend-respondents`.
- **GAP-9 (drift, unresolved) — `createSurvey` authority is stricter in code than in the design.**
  The Mar 2026 design (DR-C5) had subsequent surveys creatable by *any Safe signer* via
  `ISafe(pool.safe).isOwner(msg.sender)`; the deployed contract requires
  `pools[poolId].safe == msg.sender`, i.e. a full Safe-executed tx per survey. Deliberate tightening
  or lost in a rewrite? It materially changes organiser UX. Unchanged by the merge (contracts/
  untouched).
- **GAP-10 — RESOLVED (was: collection ownership contradicts DR-N3).** `SurveyController.create`
  now creates the survey collection via `NillionPkpClient.createCollection`, which runs the
  `owner-invocation` Lit Action so the **pool's PKP signs** the `/nil/db/collections/create` NUC
  invocation — the collection is owned by the PKP DID, not the platform builder. The old
  `NilDBBuilderService.createSurveyCollection` (builder-owned, `type: "standard"`) is no longer
  called. DR-N3 is now current.
- **GAP-11 — RESOLVED-BY-ARCHITECTURE (was: unguarded aggregated-results endpoint).** The new
  `POST /surveys/:id/results` flow runs the `owner-invocation` Lit Action per node before issuing
  the query invocation; the action verifies the `Request owner invocation` signature, `isPoolSafe`,
  and Safe `isOwner` inside the TEE. A non-owner caller gets `{ error: … }` and no invocation, so
  the endpoint is gated by the on-chain check rather than an Express guard. Residual: the Express
  route itself still performs no verification (defense-in-depth gap), and the client supplies
  `poolConfig` — trust the TEE check, not the route.
- **GAP-12 (real, security — NEW 2026-08-27) — Hardcoded Alchemy API key baked into Lit Action
  sources.** `shared/src/shared/lit/actions/owner-invocation.ts`, `user-delegation.ts`,
  `decrypt-for-owner.ts`, `decrypt-for-respondent.ts` and `decrypt.ts` embed
  `https://base-mainnet.g.alchemy.com/v2/NFOkRqUo2swIC9g5tRJ7c` in the action source that
  `PoolController.create` registers on Lit. Committed RPC key in tracked code; rotate or move to a
  per-pool env value before production.
- **GAP-13 — RESOLVED (was: hardcoded dev-pool bypass threaded through backend + frontends).** The
  dev-pool `poolId` (`5f6b3f9b-…`) shortcuts in `main.ts`, `new.ctrlr.ts.ts` and
  `survey.ctrlr.ts` are removed; the create path always mints a fresh PKP/group (GAP-3).
- **GAP-14 (real, security — NEW 2026-08-27) — Create/update HTTP endpoints are completely
  unauthenticated.** `POST /surveys` and `PUT /surveys/:id` have no `verifyMessage` and no
  middleware; the `verifySignature` middleware (`main.ts`) is defined but attached to no route (dead
  code, cf. DR-B1). Answers Q2: the backend call precedes the Safe tx. The on-chain `createSurvey`/
  `updateSurvey` tx is the real gate, but a caller can create a PKP-owned nilDB collection + query
  without the on-chain survey existing.
- **GAP-15 — OBSOLETE (was: submit error-string mismatch).** The `POST /surveys/:id/submit` route
  it described is now commented out (dead), and the respondent flow no longer branches on the
  `UNAUTHORISED` error string. Nothing to fix; the path is gone.
- **GAP-16 (minor — NEW 2026-08-27) — Pool usage keys stored in plaintext on disk.**
  `shared/src/node/lit.key-storage.ts` writes each pool's usage key to
  `.data/pool-keys/<poolId>.json` unencrypted. Runtime storage; post-merge these files are
  gitignored (`**/.data/pool-keys/*.json`) so they no longer leak into commits, but the at-rest
  plaintext remains.
- **GAP-17 (minor — NEW 2026-08-27) — Vestigial `nillai.service.ts`.**
  `nillcc-backend/src/services/nillai.service.ts` is entirely commented out (parked, per DR-B2) —
  dead code, not a secret.
- **GAP-18 (housekeeping — NEW 2026-08-27) — Dead standard-collection path left behind.** After the
  owned-collections flip, the following are no longer reachable and should be deleted or marked:
  `NilDBBuilderService.createSurveyCollection`/`submitResponseForUser`/`findSurveyResults`/
  `getOwnerReadDelegation`/`delegateCollectionToPkp`, the commented-out `POST /surveys/:id/submit`
  route, `NillDBUserService.storeStandard`, and the commented-out `nillion/delegations.ts`. Also
  stale: `EncryptedConfig.nilDid` still records the *builder* DID while the collection owner is now
  the PKP DID.
- **GAP-19 (real, integration — NEW 2026-08-27) — Delegation route contract mismatch breaks the
  live submit path.** The respondents frontend POSTs `{ userDid, signature, userAddress, poolId,
  pkpId, pkpDid }` to `/surveys/:id/delegation`, but the backend route destructures
  `{ userDid, signature, userAddress, poolId, poolConfig }` and `SurveyController.getUserDelegation`
  dereferences `poolConfig.safe` / `poolConfig.pkpId` / `poolConfig.pkpDid` — so `poolConfig` is
  `undefined` and the handler throws before returning a delegation. `storeOwned` (INV-1) therefore
  cannot currently complete end-to-end until either side is aligned (frontend sends `poolConfig`,
  or backend reads `pkpId`/`pkpDid` directly).

## Open questions

- **Q1 — CLOSED.** (Was: is `protocol/` still live?) No; Naga is deprecated. See GAP-6.
- **Q2 — ANSWERED.** Where does the Safe-executed `createSurvey`/`updateSurvey` tx sit relative to
  `SurveyController.create`/`.update`? **After** the backend call: the organiser POSTs to
  `/surveys` (backend creates the PKP-owned collection + query + encrypts + uploads to IPFS), then
  signs the on-chain tx. The Express endpoints are unauthenticated (GAP-14); the on-chain tx is the
  real gate but lags the nilDB side-effects.
- **Q3 (open)** — Was the `isOwner`-for-signers path deliberately dropped or lost? (GAP-9)
- **Q4 — CLOSED.** Is `storeOwned` to be reinstated once Nillion's owned collections stabilise, or
  has the standard-collection model become the design? **Reinstated — owned collections are the
  design.** `storeOwned` is the live write path (INV-1) with the pool PKP as collection owner
  (DR-N3, GAP-10 resolved). DR-N2 is superseded.

## Open tasks

- Wire or delete the commented-out ownership checks (GAP-1).
- Confirm and rotate/remove the key in `fund-myself.ts` (GAP-4).
- Delete or quarantine `protocol/` and `shared/lit/accs.ts` as Naga vestiges (GAP-6).
- Decide pool-update authority — now unblocked in principle by per-pool PKP, still unimplemented (GAP-5).
- Resolve the `createSurvey` authority drift (GAP-9).
- Rotate/move the Alchemy RPC key out of the Lit Action sources (GAP-12).
- Authenticate `POST/PUT /surveys` at the Express layer, or document the on-chain-first stance (GAP-14).
- Delete the dead standard-collection path and fix the stale `EncryptedConfig.nilDid` (GAP-18).
- Align the delegation route contract (frontend `pkpId`/`pkpDid` vs backend `poolConfig`) so
  `storeOwned` completes end-to-end (GAP-19).
- Real read-pass on the remaining UNVERIFIED areas: batch-card derivation (DR-O1), OPRF,
  `lit-actions/decrypt-signature.js` (GAP-8).

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