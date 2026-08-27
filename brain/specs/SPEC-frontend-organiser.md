# SPEC-frontend-organiser — `@s3ntiment/frontend-organiser` ⚠ UNVERIFIED (skimmed only)

## What it is

The creator/organiser web app: build pools & surveys, configure question groups (radio, checkbox,
scale, scored-single), generate invite batches as printable QR cards, manage respondent access
requests, and view results (per question-type result renderers). Vite build, `src/main.ts` entry,
~7.5k LOC — the largest frontend by a wide margin.

## Entry points

- `src/main.ts`, `index.html`, `vite.config.js` — standard Vite SPA.
- `src/router.ts` — client-side routing (not read).

## Key files (by directory, from the code map — not individually read)

- `src/components/survey-forms/` — question/option editors, scale config, group editor, batch
  form (`pool-form-batches.ts`).
- `src/components/survey-results/` — one renderer per question type (`checkbox-results.ts`,
  `radio-results.ts`, `scale-results.ts`, `scored-single-results.ts`).
- `src/controllers/` — `account`, `batch`, `landing`, `logout`, `new`, `overview`, `pool`,
  `survey` controllers. `pool.ctrlr.ts` and `survey.ctrlr.ts` here are the frontend counterparts to
  the backend controllers of the same name — presumably call the `/api/pools` and `/api/surveys*`
  routes in SPEC-nillcc-backend, but the actual call sites were not read this pass.
- `src/factories/` — `auth.factory.ts`, `invitation.factory.ts`, `pool.factory.ts`,
  `survey.factory.ts`.
- `src/services/services.ts` — appears to be a `ServiceContainer` per the code map; likely where
  `LitService`/`ViemService`/etc. from `shared` get instantiated for this app. Not read.
- `src/state/` — a small observable/store implementation (`observable.ts`, `store.ts`) with
  per-domain stores (`batch`, `drafts`, `pool`, `surveys`, `ui`) — looks hand-rolled, not a
  framework like Redux/Zustand.

## Shared surface consumed

⚠ UNVERIFIED — expected to be the root `@s3ntiment/shared` entry (organiser needs graphs/results/
survey types) plus `@s3ntiment/shared/browser` (WaaP, OPRF) and `@s3ntiment/shared/assets` for
styling, per the entry-point table in SPEC-shared. Not confirmed against actual imports.

## Invariants specific to this component

None confirmed — needs a real read pass before any invariant here can be trusted.

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
question; see DR-C5.
**Status:** current, with the GAP-9 ambiguity.

## Gaps / open questions

- GAP-8 (SPEC-00): this component needs a proper read before its spec is more than a file tree with
  guesses attached — including verifying DR-O1 against the actual batch code.
- GAP-9 (SPEC-00): survey-creation authority (Safe-executed vs any signer) directly shapes this app's
  flow.
- The organiser/respondent auth split (`auth.factory.ts` here vs. in `frontend-respondents`) was not
  verified.