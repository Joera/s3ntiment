# SPEC-nillcc-backend — `@s3ntiment/nillcc-backend`

## What it is

The Express API. Orchestrates `shared` + the deployed contract ABI + IPFS(Pinata) + nilDB to serve
both frontends: creates pools (provisions Lit PKP/group/actions/usage-key), creates/updates
surveys (encrypts config for owner and respondent, uploads to IPFS), issues nilDB write
delegations to respondents, accepts submitted answers, computes per-respondent scores, and returns
aggregated results to survey owners. Holds the Nillion **builder key** — the one piece of key
material with platform-wide reach (see INV-1, SPEC-00).

## Entry points

- `src/main.ts` (Express, mounted under `/api`) — the only entry point; run via `pnpm run dev`
  (`tsx watch`) or built/deployed via Docker (`Dockerfile`, `docker-compose.yaml`, not read this
  pass).
- Route surface (all under `/api`):
  - `POST /pools` → `PoolController.create`
  - `POST /surveys`, `GET /surveys/:id`, `PUT /surveys/:id` → `SurveyController`
  - `POST /surveys/:id/delegation` → `NilDBBuilderService.getUserWriteDelegation`
  - `POST /surveys/:id/submit` → signature + `isPoolMember` check, then
    `NilDBBuilderService.submitResponseForUser`
  - `POST /surveys/:id/score` → signature + `isPoolMember` check, then `SurveyController.score`
  - `POST /surveys/:id/results` → `NilDBBuilderService.findSurveyResults`
  - `POST /lit/usage-key` → signature check, then `LitPoolKeys.get(poolId)`
- A `verifySignature` Express middleware exists but is **not attached to any route** in this
  source share — each route currently does its own inline `verifyMessage` call instead. ⚠ worth
  confirming this is intentional (per-route messages differ: `s3ntiment:submit:${surveyId}` vs.
  `s3ntiment:score:${surveyId}` vs. a fixed decrypt-capability message) rather than dead code.

## Key files

- `src/services/nildb.builder.service.ts` — `NilDBBuilderService`. Holds `builderKey`/
  `builderSigner`/`builderDid`, builds per-node NUC invocations (`getInvocations`), and wraps
  collection creation, response submission (delete-then-recreate on resubmit, keyed by
  `signer` field in the filter), delegation issuance (write delegation to any DID for a survey —
  GAP-2; read delegation scoped to a survey via policy `["==", ".args.collection", surveyId]`),
  result fetching + tallying, and a **separate builder-only encryption channel**
  (`encryptToBuilder`/`decryptFromBuilder`, `eciesjs`, keyed to the builder's own DID public key —
  distinct from the Lit encryption channel, used only for the scoring answer key).
- `src/pool.ctrlr.ts` — `PoolController.create`: provisions a Lit PKP + group in parallel,
  generates the pool's two decrypt Lit Actions from the `shared` templates (closing over
  `poolId`/`contract`/`safeAddress`), registers + adds all three actions (encrypt, decrypt-owner,
  decrypt-respondent) to the group, mints a usage key scoped to that group, and caches it in
  `LitPoolKeys`. `PoolController.update` is an unimplemented stub (GAP-5, SPEC-00).
- `src/survey.ctrlr.ts` — `SurveyController.create`/`.update`: strips scoring from the config,
  encrypts owner and respondent variants via Lit, encrypts the scoring answer key to the builder,
  uploads the resulting `EncryptedConfig` to Pinata. `.get` fetches by on-chain CID lookup +
  IPFS fetch, stripping `encryptedScoring` before returning (respondent/owner-safe read). `.score`
  decrypts the scoring key from the builder-only channel, finds the respondent's own submission by
  signer address, and computes a score locally — the answer key never leaves the backend in
  plaintext. Ownership-check code (`verifyPoolOwner`, `verifyOwnership`) is written but fully
  commented out (GAP-1, SPEC-00).
- `src/contract.factory.ts` — read-only viem client against Base, wraps `getSurvey`.
- `src/key.management.ts` — currently just a commented-out cron sketch for usage-key rotation; no
  active code.
- `src/env.ts` — dotenv loading, resolves `.env` relative to the file (checked in first, before
  any other import — correctly ordered in `main.ts` via `import './env.js'` as the first line).

## Shared surface consumed

- `@s3ntiment/shared` (root): `ViemService`, `LitService`, `IPFSMethods`, `QuestionGroup`,
  `Survey`, `tallyResults`, `createSurveyCollectionSchema`, `EncryptedConfig`,
  `getDecryptForOwnerAction`, `getDecryptForRespondentAction`, `encryptAction`,
  `getSimpleDecrypt`, `compactAction`, `isScored`, `stripScoring`, `calculateScore`.
- `@s3ntiment/shared/node`: `initStorage`, `LitPoolKeys`.
- `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` — the deployed ABI, imported
  directly (not via a package export) in three files (`main.ts`, `contract.factory.ts`,
  `survey.ctrlr.ts`, `pool.ctrlr.ts`).

## Invariants specific to this component

- The builder key is the only credential that touches every survey; per INV-1 (SPEC-00) it is
  never given `write` in any respondent's ACL — confirmed at the call sites in this component
  (`getOwnerReadDelegation`, `getUserWriteDelegation` both issue delegations to *other* DIDs, never
  self-grant write).
- Resubmission is delete-then-recreate, not patch, on both the builder side
  (`submitResponseForUser`) and the user side (`NillDBUserService.updateOwned` in `shared`) — keep
  these two paths in sync if one changes.
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
- GAP-2 (SPEC-00): no membership check in `getUserWriteDelegation`.
- GAP-3 (SPEC-00): hardcoded fallback usage key and `pkpId`.
- GAP-5 (SPEC-00): `PoolController.update` unimplemented — blocked on DR-L3.
- GAP-10 (SPEC-00): `createSurveyCollection` sets the builder as collection owner, contradicting
  DR-N3.
- DR-B1: unused `verifySignature` middleware.