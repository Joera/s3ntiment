# SPEC-frontend-organiser — `@s3ntiment/frontend-organiser`

> Verified 2026-08-27 at the create + results call sites (`new.ctrlr.ts.ts`, `survey.ctrlr.ts`,
> `draft-survey-editor.ts`). Batch-card derivation (DR-O1) and the auth factory remain ⚠ UNVERIFIED.

## What it is

The creator/organiser web app: build pools & surveys, configure question groups (radio, checkbox,
scale, scored-single), generate invite batches as printable QR cards, manage respondent access
requests, and view results (per question-type result renderers). Vite build, `src/main.ts` entry,
~7.4k LOC — the largest frontend by a wide margin.

## Entry points

- `src/main.ts`, `index.html`, `vite.config.js` — standard Vite SPA.
- `src/router.ts` — client-side routing.

## Key files (verified call sites)

- `src/controllers/new.ctrlr.ts.ts` — the **per-pool creation flow** (owned-collections merge): on
  `survey-submit` it derives `poolId`/`safeAddress` (fresh Safe for a new pool, existing pool's
  Safe otherwise), signs `Request owner invocation`, then:
  1. `POST /api/pools` → `{ pkpId, pkpDid, groupId }` (backend mints the per-pool PKP/group).
  2. `createBatch` per batch (invite cards), then a Safe-executed `createSurvey` tx on-chain.
  3. `POST /api/builder/register` → registers the PKP as a nilDB builder.
  4. Stores the pool (with `config: { safe, chainId, litNetwork, pkpId, pkpDid, groupId }`) via
     `store.addPool`.
  5. `POST /api/surveys` with `surveyConfig` (backend creates the PKP-owned collection + query,
     encrypts, uploads to IPFS) → `{ cid }`, then a Safe-executed `updateSurvey` tx.
  UI steps include `creating-pool`, `creating-invites`, **`register-pool`** (new step),
  `creating-survey`, `submitting-tx`, `error`.
- `src/controllers/survey.ctrlr.ts` — survey detail/results view: `process()` connects to the
  pool's Safe, decrypts via `fetchAndDecryptSurveyWithOwner(…, this.pool.config, …)`, and
  `refreshResponses()` POSTs `{ auth: { signature, userAddress }, queryIds, poolId, groups,
  poolConfig }` to `/api/surveys/:id/results` (PKP-owned aggregation query, GAP-11).
- `src/components/draft-survey-editor.ts` — the multi-step survey builder; step type now includes
  `register-pool`.
- `src/components/survey-forms/` — question/option editors, scale config, group editor, batch
  form (`pool-form-batches.ts`). ⚠ not read this pass.
- `src/components/survey-results/` — one renderer per question type (`checkbox-results.ts`,
  `radio-results.ts`, `scale-results.ts`, `scored-single-results.ts`). ⚠ not read this pass.
- `src/controllers/` — `account`, `batch`, `landing`, `logout`, `new`, `overview`, `pool`,
  `survey` controllers.
- `src/factories/` — `auth.factory.ts`, `invitation.factory.ts`, `pool.factory.ts`,
  `survey.factory.ts`.
- `src/services/services.ts` — `ServiceContainer`; instantiates `LitService`/`ViemService`/etc.
  from `shared` for this app.
- `src/state/` — hand-rolled observable/store (`observable.ts`, `store.ts`) with per-domain stores
  (`batch`, `drafts`, `pool`, `surveys`, `ui`).

## Shared surface consumed

Verified at the create/results call sites: root `@s3ntiment/shared` (survey types, `Batch`,
`fetchAndDecryptSurveyWithOwner`, `createBatch`), `@s3ntiment/shared/browser` (WaaP, OPRF) and
`@s3ntiment/shared/assets` for styling, plus `s3ntiment-contracts` ABI. Full import surface not
enumerated.

## Invariants specific to this component

- Pool creation is a **per-pool PKP provisioning flow**: the backend mints PKP/group/usage-key and
  the organiser registers the PKP as the nilDB builder before the survey is created (INV-10).
- The organiser never holds the pool's PKP private key or usage key — those live in the backend /
  Lit; the frontend only carries `pkpId`/`pkpDid`/`groupId` in the pool's `config`.
- Results are fetched via the PKP-owned aggregation query, not by reading raw records.

---

# Decision record

### DR-O1 — Batch generation costs one wallet popup, not N
**When:** Feb 2026 — the client-side consequence of **DR-C1**.
**Decision:** `pool-form-batches.ts` / `batch.ctrlr.ts` implement: sign one random seed with the pool
Safe → derive an ephemeral batch wallet in memory → sign every card's nullifier locally with that
wallet → print. The organiser sees a single signature request per print run.
**Why / rejected:** per-card signing (N popups, unusable) and platform-key signing (violates pillar
2) were both rejected — see DR-C1 in SPEC-contracts for the full reasoning and the accepted
limitation.
**⚠ UNVERIFIED:** the batch derivation code was not read in this pass; the above is the design as
decided, and should be checked against `invitation.factory.ts` / `batch.ctrlr.ts`.
**Status:** current.

### DR-O2 — Organiser authority is the pool Safe
**When:** Mar 2026.
**Decision:** the organiser side authenticates as a **Safe signer**, and pool/survey mutations are
Safe-executed transactions. There is no s3ntiment-side organiser account with elevated rights.
**Why:** pillar 2 plus the public promise that co-organisers of a pool govern collectively — *no
single organiser has more rights or power than the others.* A conventional owner-account model would
have made s3ntiment the arbiter of who may act.
**⚠ Open (GAP-9):** whether an individual Safe signer can create a survey directly
(`ISafe.isOwner`) or every survey needs a full Safe-executed tx is currently ambiguous — the Mar 2026
design said the former, the deployed contract enforces the latter. This is *the* organiser UX
question; see DR-C5. Post-merge the flow does a full Safe-executed `createSurvey`/`updateSurvey`
tx per survey, consistent with the contract.
**Status:** current, with the GAP-9 ambiguity.

## Gaps / open questions

- GAP-9 (SPEC-00): survey-creation authority (Safe-executed vs any signer) directly shapes this app's
  flow.
- GAP-14 (SPEC-00): the `POST /api/surveys` call this app makes is unauthenticated at the Express
  layer.
- DR-O1 (batch derivation) and the organiser/respondent auth split (`auth.factory.ts`) remain
  ⚠ UNVERIFIED.
- TBD — Cross-frontend bridge test (DEFERRED, awaiting test chain): an end-to-end test that takes a
  card generated by the organiser FE's real `generateCardSecrets`, feeds it through the respondent
  FE's real `parseCardURL`/`AuthController` success path, and asserts it reaches `navigate` (and that
  a used card short-circuits). Deliberately deferred until a test chain (local Hardhat node / testnet)
  is available, because the `Card.register`/`isUsed` writes and signer recovery are only meaningful
  on-chain. Currently the producer (`organiser-invite-tests`) and consumer (`card-signature.seam` /
  `card-url.round-trip` / `auth-ctrlr`) halves are drift-protected by both importing the same shared
  encoding module, but are not yet exercised as one integrated flow against a live chain.