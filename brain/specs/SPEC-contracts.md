# SPEC-contracts — `s3ntiment-contracts`

## What it is

The single on-chain trust boundary. One contract, `S3ntimentSurveyStore.sol` (deployed on Base;
`deployments/{base,sepolia}/`), holds pool ownership, survey→pool linkage, batch/card issuance,
and the pool-membership registry that every Lit access-control condition and every backend
authorization check ultimately reads from. A secondary `GreetingsRegistry` exists (test-covered)
but is not part of the survey/pool domain — looks like a template/example contract, not treated
further here.

## Entry points

- `hardhat.config.ts` + `rocketh` (`rocketh/config.ts`, `rocketh/deploy.ts`,
  `rocketh/environment.ts`) — deploy tooling.
- `deploy/001_deploy_survey_store.ts` — the actual deploy script.
- Read/write access from the rest of the monorepo is always through the deployed ABI JSON
  (`s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json`), imported directly by
  `nillcc-backend` (`contract.factory.ts`, `main.ts`, `survey.ctrlr.ts`) and referenced inside
  generated Lit Action code strings (`shared/lit/actions/*`).

## Key files

- `src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` — everything. Unusually well
  self-documented in its header comment (data model, ownership model, card-generation flow,
  registration flow, participation flow, privacy properties, key design decisions all spelled
  out in the source) — read the header comment before the function bodies, it *is* most of this
  spec already.
- `test/GreetingsRegistry.test.ts` — only test file present in this pass; covers the unrelated
  `GreetingsRegistry`, not `S3ntimentSurveyStore`. ⚠ No test file for `S3ntimentSurveyStore` was
  in the source share — either it exists elsewhere and wasn't included, or the core contract is
  untested. Worth confirming.

## Data model (from contract storage)

- `Pool { safe, createdAt }` — keyed by string `poolId`. A pool exists once its `safe != address(0)`.
- `Survey { ipfsCid, poolId, createdAt }` — keyed by string `surveyId`. The `ipfsCid` points at
  the `EncryptedConfig` blob (see SPEC-shared) uploaded via Pinata.
- `Batch { createdAt, cardCount }` — keyed by `(poolId, batchId)` where `batchId` *is* the batch
  wallet address (no separate UUID — explicit design decision in the contract comment).
- `usedNullifiers: bytes32 → bool` — global nullifier set, prevents card reuse.
- `poolMembers: (poolId, address) → bool` — the fact every Lit ACC and backend membership check
  reads.

## Flows

- **Card generation (off-chain)**: pool Safe signs a random seed → derives an ephemeral batch
  wallet → batch wallet address registered via `createSurvey()` (new pool) or `registerBatch()`
  (existing pool) → each card's nullifier signed locally by the batch wallet, no wallet popups →
  printed as QR: `{ nullifier, batchId, signature, poolId }`.
- **Registration (on-chain, exactly once per respondent per pool)**: WaaP mints a fresh EOA (pool
  wallet) → an SMC (gas-abstraction smart contract) owned by that EOA calls `registerInPool()` →
  contract verifies the card signature was made by the claimed `batchId`, checks the nullifier is
  unused, resolves identity via `ISMC(msg.sender).owner()`, burns the nullifier, records
  membership.
- **Survey participation (off-chain, no on-chain write)**: Lit checks `isPoolMember(poolId,
  :userAddress)` as an access condition; survey-level double-response prevention lives in nilDB
  (`NilDBBuilderService.exists`/delete-then-recreate in `submitResponseForUser`), not on-chain.

## Invariants specific to this component

- `createSurvey` is the only pool-bootstrapping path: a pool is created implicitly by the first
  survey that references it, with `msg.sender` becoming the Safe. There is no explicit
  `createPool()` entry point.
- Batch signers are immutable once registered (no update/removal function) — explicitly "protects
  printed cards" per the contract's own comment.
- No events are emitted anywhere in the contract — storage is read directly by Lit Actions and the
  frontend/backend, not via event logs. Any future indexing/subgraph work would need to poll
  storage or add events.
- The SMC layer is purely gas abstraction; the contract never trusts `msg.sender` as the
  respondent's real identity, only `ISMC(msg.sender).owner()`.


---

# Decision record

### DR-C1 — Card nullifiers are signed by an ephemeral batch wallet
**When:** Feb 2026.
**Decision:** The pool Safe signs one random seed → derives an ephemeral batch wallet → that
wallet's address is registered on-chain as the `batchId` → every card's nullifier is signed locally
by the batch wallet. One wallet popup per print run, none per card.
**Why:** the sweet spot between UX and trust. The contract can verify that a submitted nullifier was
signed by the registered batch key, which is exactly the threat we care about — *respondent-side
forgery*.
**Rejected:**
- **Sign each card individually with the creator's wallet** — maximum trustlessness, but N wallet
  popups for a print run of N cards. Unusable.
- **Sign with a platform key** — zero popups, but shifts trust to s3ntiment and directly violates
  pillar 2 ("not a platform"). Non-starter.
**Known limitation, accepted deliberately:** the contract cannot verify *how* the batch wallet was
derived, so it cannot stop a creator minting extra cards. That is out of threat model — the creator
already controls batch size. The threat model is respondent forgery, not creator over-issuance.
**Status:** current.

### DR-C2 — `batchId` **is** the batch wallet address
**When:** Feb 2026.
**Decision:** No separate batch UUID. The address is the identifier; storage is keyed
`mapping(string => mapping(address => Batch))`.
**Why:** the signature recovery already yields the address, so a second identifier is pure
indirection — `batch.signerWallet` and `batchId` were always the same value.
**Status:** current.

### DR-C3 — Batches are scoped to a pool, not a survey
**When:** originally survey-scoped (Feb 2026), re-scoped with the pool model (Mar 2026).
**Decision:** `batches[poolId][batchId]`. A card is a **pool invitation, not a survey invitation**.
**Why:** follows directly from DR-C4 — respondents join a panel, then answer any survey in it. A
survey-scoped card would force re-invitation per survey, defeating the panel model.
**Superseded:** the Feb 2026 contract's comment "batches are scoped to a survey — a batch wallet
cannot be reused across surveys". If you find that phrasing anywhere, it's stale.
**Status:** current.

### DR-C4 — The pool model replaces the standalone-survey model
**When:** Mar 2026 (thread: "S3ntiment pool model contract redesign").
**Decision:** A pool is a named collection of surveys with a shared respondent registry. **A
standalone survey is a degenerate case: a pool with exactly one survey — no special casing.**
Respondents join a pool once; survey participation is off-chain thereafter.
**Why:** the earlier model keyed everything to `Survey { owner }` and would have needed a fresh
on-chain registration per survey — expensive, and it would have written participation on-chain,
breaking the privacy property that survey participation is invisible.
**Superseded:** `S3ntimentSurveyStore` v1 with `Survey { ipfsCid, owner, createdAt }` and
`validateCard()`. Also the intermediate name `S3ntimentPoolStore` — the contract kept its original
name; don't be confused by the pool-store naming in older drafts.
**Status:** current.

### DR-C5 — A pool is created implicitly by the first `createSurvey`
**When:** Mar 2026, after two rejected shapes.
**Decision:** No explicit `createPool()`. If `pools[poolId].safe == address(0)`, the pool is
bootstrapped with `msg.sender` as its Safe and the passed `batchIds` are registered.
**Why:** removes a whole governance transaction from onboarding, and removes the "pool exists but has
no surveys" state entirely.
**Rejected:**
- **Explicit `createPool()` as a Safe-executed governance tx** — one more multisig round trip for no
  additional guarantee.
- **`createSurvey` callable by any Safe signer via `ISafe(pool.safe).isOwner(msg.sender)`** — the
  Mar 2026 design had this asymmetry (pool creation = governance, survey creation = operational).
**⚠ DRIFT (GAP-9):** the deployed contract does **not** implement the `isOwner` path. It requires
`pools[poolId].safe == msg.sender` for every subsequent survey — a full Safe-executed tx each time.
Either the asymmetry was deliberately dropped or it was lost in the rewrite. Unresolved (Q3), and it
matters: it's the difference between "any organiser can launch a survey" and "every survey needs
quorum".
**Status:** current, with drift.

### DR-C6 — SMC indirection retained for gas abstraction
**When:** Mar 2026, actively questioned and then kept.
**Decision:** The respondent's pool wallet EOA owns a smart contract account (SMC, Pimlico paymaster
for gas); the SMC calls `registerInPool()` and the contract resolves identity via
`ISMC(msg.sender).owner()`.
**Why:** the respondent must not need gas. The EOA remains the identity of record, so
`isPoolMember(poolId, address)` and Lit's `:userAddress` both resolve to the same key that signs Lit
auth — the indirection is invisible downstream.
**Rejected:** **pool wallet EOA calls `registerInPool()` directly.** Simpler and matches the "fresh
EOA" language, but requires the respondent to hold gas on Base. Killed on UX.
**Status:** current. Note the SMC is *purely* gas abstraction — the contract never treats
`msg.sender` as the identity.

### DR-C7 — No events emitted
**When:** between the Feb and Mar 2026 rewrites.
**Decision:** the contract emits nothing; storage is read directly by Lit Actions, backend and
frontends.
**Why:** every consumer needs *current state* (`isPoolMember`, `getSurvey`), not history. Lit Actions
in particular read storage via `ethers.Contract` view calls inside the TEE — events would be useless
to them.
**Superseded:** v1 had `SurveyCreated` / `BatchRegistered` events.
**Consequence to know:** there is no event log, so any future indexer or subgraph would need events
added back. Don't assume they exist.
**Status:** current.

### DR-C8 — Survey-level nullifiers live in nilDB, not on-chain
**When:** Mar 2026, with the pool model.
**Decision:** Double-response prevention *within* a survey is enforced off-chain — the backend finds
an existing document by `signer` and deletes it before writing the new one.
**Why:** an on-chain survey-level nullifier would record participation on-chain, destroying the
privacy property that survey participation is invisible. It would also cost a transaction per
survey per respondent.
**Consequence:** this is also what makes pillar 4 (continuous feedback / editable answers) work —
resubmission is delete-then-recreate, not a blocked duplicate.
**Status:** current.

## Gaps / open questions

- No visible test coverage for `S3ntimentSurveyStore` in this source share (only
  `GreetingsRegistry.test.ts`, which is unrelated template code). Confirm whether a suite exists.
- GAP-9 / Q3 — the `isOwner` drift in DR-C5.
- `registerBatch()` places no bound on batch count per pool. Not a correctness issue; note it if
  batch count ever becomes operationally relevant.