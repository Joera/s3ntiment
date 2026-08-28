# SPEC-nillcc-backend — `@s3ntiment/nillcc-backend`

## What it is

The Express API. Orchestrates `shared` + the deployed contract ABI + IPFS(Pinata) + nilDB to serve
both frontends: creates pools (mints a per-pool Lit PKP, registers six Lit actions, creates a Lit
group, mints a pool-scoped usage key), registers the PKP as a nilDB builder, creates/updates
surveys (creates the PKP-owned nilDB collection + aggregation query, encrypts config for owner and
respondent, uploads to IPFS), issues PKP-signed nilDB write delegations to respondents, computes
per-respondent scores, and returns aggregated results via the PKP-owned aggregation query. The
platform Nillion **builder key** is now demoted to the scoring ECIES channel (DR-S1) and
`initBuilder` — it is no longer the collection owner (INV-9, GAP-10 resolved).

## Entry points

- `src/main.ts` (Express, mounted under `/api`) — the only entry point; run via `pnpm run dev`
  (`tsx watch`) or built/deployed via Docker (`Dockerfile`, `docker-compose.yaml`, not read this
  pass).
- Route surface (all under `/api`):
  - `POST /pools` → `PoolController.create` — mints the per-pool PKP, registers six actions,
    creates the group, mints the usage key, returns `{ pkpId, pkpDid, groupId }`.
  - `POST /builder/register` → `PoolController.registerBuilder` →
    `NillionPkpClient.registerAsBuilder` — registers the pool's PKP DID as a nilDB builder.
  - `POST /surveys`, `GET /surveys/:id`, `PUT /surveys/:id` → `SurveyController` — `create` also
    creates the PKP-owned collection + aggregation query via `NillionPkpClient`.
  - `POST /surveys/:id/delegation` → `SurveyController.getUserDelegation` →
    `NillionPkpClient.getUserWriteDelegation` — runs the `user-delegation` Lit Action so the PKP
    signs a nilDB write delegation for the respondent (membership-checked inside the action).
    ⚠ GAP-19: the route expects `poolConfig` in the body but the respondents frontend sends
    `pkpId`/`pkpDid` — the handler dereferences `poolConfig.*` and throws today.
  - `POST /surveys/:id/submit` → **commented out** (dead standard-collection path, GAP-18).
  - `POST /surveys/:id/score` → signature + `isPoolMember` check, then `SurveyController.score`
    (unchanged — still the builder-ECIES scoring channel, DR-S1).
  - `POST /surveys/:id/results` → `NillionPkpClient.runQuery` + `readQueryResults` — runs the
    PKP-owned aggregation query per node and combines shares (owner-gated inside the
    `owner-invocation` action, GAP-11).
  - `POST /lit/usage-key` → signature check, then `LitPoolKeys.get(poolId)` (no fallback literal
    post-merge, GAP-3).
- A `verifySignature` Express middleware exists but is **not attached to any route** in this
  source share — each route currently does its own inline `verifyMessage` call instead (DR-B1;
  GAP-14: `POST/PUT /surveys` have no check at all).

## Key files

- `src/services/nildb.pkp.service.ts` — **`NillionPkpClient` (NEW, the owned-collections core).**
  Wraps the per-pool PKP for nilDB: `registerAsBuilder` (registers the PKP DID as a nilDB builder),
  `createCollection` / `createQuery` (PKP-signed `/nil/db/collections/create` and
  `/nil/db/queries/create` NUC invocations), `getUserWriteDelegation` (PKP-signed
  `/nil/db/data/create` delegation via the `user-delegation` action), `runQuery` +
  `readQueryResults` (execute the aggregation query per node, combine shares via
  `combineShares`). Every command runs the `owner-invocation` Lit Action first, so the PKP signs the
  invocation only after the action verifies the caller is a Safe signer of the pool's Safe (INV-5).
  Hardcodes the three nilDB staging node URLs/DIDs.
- `src/pool.ctrlr.ts` — `PoolController.create`: mints the per-pool PKP and fetches all six action
  CIDs in parallel, registers the actions (returning `hashedCid`s), creates a group permitting
  exactly that PKP + those CIDs, mints a pool-scoped usage key (cached in `LitPoolKeys`), then runs
  the `get-public-key` action to derive `pkpDid` via `publicKeyToDidKey`. Returns
  `{ pkpId, pkpDid, groupId }`. `PoolController.registerBuilder` delegates to
  `NillionPkpClient.registerAsBuilder`. `PoolController.update` is still an unimplemented stub
  (GAP-5).
- `src/survey.ctrlr.ts` — `SurveyController.create`: reads `pkpId`/`pkpDid` from
  `surveyConfig.config` (no hardcoded fallback, GAP-3), creates the PKP-owned collection
  (`type: "owned"`) and the aggregation query via `NillionPkpClient`, stores `queryIds` on the
  config, encrypts owner/respondent variants via Lit, encrypts the scoring answer key to the
  builder (DR-S1), uploads the `EncryptedConfig` to Pinata. `.update` uses `poolConfig.pkpId` for
  encryption. `.get` fetches by on-chain CID lookup + IPFS fetch, stripping `encryptedScoring`
  before returning. `.score` decrypts the scoring key from the builder-only channel, finds the
  respondent's own submission by signer address, and computes a score locally. `getUserDelegation`
  builds a `NillionPkpClient` and returns the PKP-signed write delegation. Ownership-check code
  (`verifyPoolOwner`, `verifyOwnership`) is written but fully commented out (GAP-1).
- `src/services/nildb.builder.service.ts` — `NilDBBuilderService`, **demoted post-merge.** Still
  live: `initBuilder` (registers the platform builder DID), `encryptToBuilder`/`decryptFromBuilder`
  (the scoring ECIES channel, DR-S1), `exists`/`getResponseById` (the score path). Dead/unreachable
  (GAP-18): `createSurveyCollection`, `submitResponseForUser`, `findSurveyResults`,
  `getOwnerReadDelegation`, `delegateCollectionToPkp`, `getBuilderProfile`, `getCollectionInfo`,
  `testDelegationFormat`, and the commented-out `getUserWriteDelegation`.
- `src/contract.factory.ts` — read-only viem client against Base, wraps `getSurvey`.
- `src/key.management.ts` — currently just a commented-out cron sketch for usage-key rotation; no
  active code.
- `src/env.ts` — dotenv loading, resolves `.env` relative to the file (checked in first, before
  any other import — correctly ordered in `main.ts` via `import './env.js'` as the first line).

## Shared surface consumed

- `@s3ntiment/shared` (root): `ViemService`, `LitService`, `IPFSMethods`, `QuestionGroup`,
  `Survey`, `PoolConfig`, `EncryptedConfig`, `createSurveyCollectionSchema`,
  `createSurveyAggregationQuery`, `combineShares`, `getDecryptForOwnerAction`,
  `getDecryptForRespondentAction`, `getPkpPublicKeyAction`, `ownerInvocationAction`,
  `userDelegationAction`, `publicKeyToDidKey`, `encryptAction`, `compactAction`, `isScored`,
  `stripScoring`, `calculateScore`, `withRetry`.
- `@s3ntiment/shared/node`: `initStorage`, `LitPoolKeys`.
- `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` — the deployed ABI, imported
  directly (not via a package export) in `main.ts`, `contract.factory.ts`, `survey.ctrlr.ts`,
  `pool.ctrlr.ts`.

## Invariants specific to this component

- The **per-pool PKP** is the only credential that touches its pool's nilDB collections; it is
  registered as the nilDB builder and signs every NUC invocation for its pool (INV-9). The
  platform builder key no longer owns or writes respondent data — it survives only for the scoring
  ECIES channel (DR-S1) and `initBuilder`.
- The respondent write delegation is **membership-checked inside the `user-delegation` Lit Action**
  (`isPoolMember`), not at the Express layer — GAP-2 resolved (INV-5).
- Resubmission is delete-then-recreate, not patch, on the user side (`NillDBUserService.updateOwned`
  in `shared`); the old builder-side equivalent (`submitResponseForUser`) is dead code (GAP-18).
- `/api/lit/usage-key` returns a **pool-scoped** key gated only by a fixed-message signature
  check (`'Request capability to decrypt'`) — it does not itself check pool membership; membership
  is enforced downstream inside the Lit Action the key is used to invoke (INV-5, SPEC-00), not at
  this endpoint. That's consistent with the on-chain-first invariant, but means this endpoint
  alone is not an authorization boundary — don't treat a 200 from it as proof of membership.

---

# Decision record

### DR-S1 — The scoring answer key is encrypted to the builder DID (ECIES) — TEMPORARY
**When:** Mar 2026 (thread: "Scoring sentiment analysis quiz questions").
**The dilemma:** for scored surveys (quizzes, exams), *who* may decrypt the correct answers and
compute scores? The tension is **immediacy vs integrity** — an ad hoc quiz wants a score the instant
you submit; an exam must stop early finishers leaking answers to those still answering.
**Options considered:**
1. **Completion-gated** — a contract method marks a participant complete, a Lit condition unlocks
   decryption for them. Clean trust model, but leaky: a completed participant can just tell someone
   who hasn't submitted.
2. **Time-gated** — the survey closes at a fixed timestamp, answers unlock after. Works for exams,
   breaks ad hoc use — you can't know in advance when the last person submits.
3. **Owner-gated** — the owner manually closes the survey and triggers scoring. Same ad hoc problem,
   plus a human step that can be forgotten or manipulated.
4. **Quizmaster-gated** — encrypt the answer key to a trusted third-party identity.
**Decision:** option 4, with the **builder DID as the quizmaster**. The scoring object is encrypted
to the builder DID's secp256k1 public key with ECIES (`eciesjs`) — deliberately *not* via Lit, since
the builder DID is a Nillion identity, not a Lit encryption target. The backend decrypts server-side
and scores.
**Why:** it works for every quiz type with no timing constraints and no contract changes, and it
keeps respondents away from the answer key regardless of completion status.
**⚠ Cost, stated plainly:** s3ntiment holds the builder private key, so s3ntiment could decrypt any
answer key at will, and a server compromise exposes them all. **This contradicts pillar 2 directly** —
respondents must trust s3ntiment as an institution rather than trusting the math. It is a stepping
stone, and it is marked as one in the code (`// temp solution .. see dilemma in obsidian`).
**Exit path — and a correction worth remembering:** moving decryption into a **nilCC TEE was
considered and is not sufficient**. The TEE stops s3ntiment reading plaintext during computation, but
s3ntiment still chooses which program runs and still controls the builder DID — the platform risk
moves, it doesn't reduce. What actually satisfies pillar 2:
- **PKP + auditable Lit Action** — the decryption key is held by a PKP, released only when an
  immutable IPFS-addressed action's conditions pass. Removes s3ntiment from the trust chain. This is
  the intended direction and matches the rest of the architecture.
- **or: encrypt the answer key to the pool Safe** — the owner is sovereign, the platform is a
  conduit.
**Status:** TEMPORARY. The endpoint shape (`POST /surveys/:id/score`) is designed so the decryption
mechanism can be swapped without touching the frontend or data model.

**Post-merge note (2026-08-27):** the PKP path above is now *partially* realized — the per-pool PKP
owns the nilDB collections and signs all NUC invocations (INV-9), but the **scoring answer key is
still encrypted to the platform builder DID** via ECIES. The answer key remains the one place the
platform holds a private key that can decrypt respondent-facing secrets; moving it to the PKP is the
remaining step.

### DR-B1 — Per-route signature messages instead of shared middleware
**When:** visible in current code, rationale not recorded in chat.
**Observation:** a `verifySignature` middleware exists in `main.ts` but is attached to no route.
Each route instead verifies inline against a route-specific message (`s3ntiment:submit:${surveyId}`,
`s3ntiment:score:${surveyId}`, `'Request capability to decrypt'`).
**Why this is probably right:** a shared middleware would need a single message format; distinct
per-action messages stop a signature captured for one action being replayed against another.
**⚠ Unrecorded:** confirm this was intentional and then either delete the middleware or repurpose it
to take the expected message as a parameter. Right now it reads as dead code that a future reader
may "helpfully" wire up, weakening the separation.
**Status:** current, undocumented.

### DR-B2 — nilAI (private LLM inference) parked
**When:** package removed from the recommended dependency set Feb 2026; service commented out.
**Decision:** `nillai.service.ts` is entirely commented out; `@nillion/nilai-ts` was explicitly
identified as not needed for survey storage.
**Why:** nilAI is for private LLM inference over responses — a genuine future capability (blind
synthesis, latent-consensus discovery) but orthogonal to getting storage and access control right.
**Status:** parked, not rejected. If roadmap docs promise AI synthesis, this is where it lands.

## Gaps / open questions

- GAP-1 (SPEC-00): commented-out ownership checks in `survey.ctrlr.ts`. Note the tension with
  DR-C5/GAP-9 — if every survey write is a Safe-executed tx, the on-chain check really is
  sufficient; if the `isOwner` path returns, it may not be.
- GAP-5 (SPEC-00): `PoolController.update` unimplemented — now unblocked in principle by the
  per-pool PKP, still a stub.
- GAP-12 (SPEC-00): hardcoded Alchemy RPC key in the Lit Action sources this component registers.
- GAP-14 (SPEC-00): `POST/PUT /surveys` are unauthenticated at the Express layer.
- GAP-18 (SPEC-00): dead standard-collection methods in `nildb.builder.service.ts` and the
  commented-out `/submit` route.
- GAP-19 (SPEC-00): delegation-route contract mismatch — backend expects `poolConfig`, frontend
  sends `pkpId`/`pkpDid`; the live submit path throws today.
- DR-B1: unused `verifySignature` middleware.