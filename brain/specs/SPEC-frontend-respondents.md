# SPEC-frontend-respondents — `frontend-respondents` ⚠ UNVERIFIED (skimmed only)

## What it is

The respondent-facing web app: scan a QR invite card, authenticate (WaaP email/phone login +
presumably OPRF, per `shared/browser/oprf`), answer a survey privately, see a completion/used-card
view. Vite build, `src/main.ts` entry, ~2.4k LOC.

## Entry points

- `src/main.ts`, `index.html`, `vite.config.js`.
- `lit-actions/decrypt-signature.js` — a Lit Action **checked into this app directly**, separate
  from the templated actions in `shared/lit/actions/*`. ⚠ Not read — worth checking whether this
  duplicates or replaces `getDecryptForRespondentAction`, since having decrypt logic in two places
  (templated in `shared`, static here) is the kind of drift Soul2Soul's spec pass flagged as a gap
  in its own shared package.

## Key files (by directory, from the code map — not individually read)

- `src/controllers/` — `about`, `auth-ctrlr`, `completed-ctrlr`, `invalid-card-ctrlr`,
  `survey.ctrlr`, `used-card-ctrlr`. The presence of `invalid-card-ctrlr` and `used-card-ctrlr` as
  distinct controllers suggests the nullifier-reuse and bad-signature cases from
  `S3ntimentSurveyStore.registerInPool` (`NullifierAlreadyUsed`, `InvalidSignature`) surface as
  distinct UI states here — plausible but not confirmed against the contract error names.
- `src/components/security-questions.ts`, `survey-questions.ts` — the actual answer-taking UI.
- `src/state/` — same hand-rolled observable/store pattern as the organiser app, plus a
  `user.store.ts` not present on the organiser side.
- `src/auth.factory.ts`, `src/ux.factory.ts` — presumably where WaaP login +
  `createNillDBSeed()` (from `shared/browser/evm/waap.service.ts`) get wired together into an
  actual login flow. Not read.

## Shared surface consumed

⚠ UNVERIFIED — expected `@s3ntiment/shared` root (survey types, `NillDBUserService`) plus
`@s3ntiment/shared/browser` (`WaapService`, OPRF) per the entry-point contract in SPEC-shared. Not
confirmed against actual imports.# SPEC-frontend-respondents — `frontend-respondents` ⚠ UNVERIFIED (skimmed only)

## What it is

The respondent-facing web app: scan a QR invite card, authenticate (WaaP email/phone login +
presumably OPRF, per `shared/browser/oprf`), answer a survey privately, see a completion/used-card
view. Vite build, `src/main.ts` entry, ~2.4k LOC.

## Entry points

- `src/main.ts`, `index.html`, `vite.config.js`.
- `lit-actions/decrypt-signature.js` — a Lit Action **checked into this app directly**, separate
  from the templated actions in `shared/lit/actions/*`. ⚠ Not read — worth checking whether this
  duplicates or replaces `getDecryptForRespondentAction`, since having decrypt logic in two places
  (templated in `shared`, static here) is the kind of drift Soul2Soul's spec pass flagged as a gap
  in its own shared package.

## Key files (by directory, from the code map — not individually read)

- `src/controllers/` — `about`, `auth-ctrlr`, `completed-ctrlr`, `invalid-card-ctrlr`,
  `survey.ctrlr`, `used-card-ctrlr`. The presence of `invalid-card-ctrlr` and `used-card-ctrlr` as
  distinct controllers suggests the nullifier-reuse and bad-signature cases from
  `S3ntimentSurveyStore.registerInPool` (`NullifierAlreadyUsed`, `InvalidSignature`) surface as
  distinct UI states here — plausible but not confirmed against the contract error names.
- `src/components/security-questions.ts`, `survey-questions.ts` — the actual answer-taking UI.
- `src/state/` — same hand-rolled observable/store pattern as the organiser app, plus a
  `user.store.ts` not present on the organiser side.
- `src/auth.factory.ts`, `src/ux.factory.ts` — presumably where WaaP login +
  `createNillDBSeed()` (from `shared/browser/evm/waap.service.ts`) get wired together into an
  actual login flow. Not read.

## Shared surface consumed

⚠ UNVERIFIED — expected `@s3ntiment/shared` root (survey types, `NillDBUserService`) plus
`@s3ntiment/shared/browser` (`WaapService`, OPRF) per the entry-point contract in SPEC-shared. Not
confirmed against actual imports.

## Invariants specific to this component

None confirmed.


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

- GAP-8 (SPEC-00): needs a real read pass.
- `lit-actions/decrypt-signature.js` vs `shared/lit/actions/decrypt-for-respondent.ts` — possible
  duplication. Under DR-L4 each pool's action is generated with its constants baked in, so a static
  checked-in action is suspicious: either it predates DR-L4 or it serves a different purpose. Diff
  them before assuming equivalence.

## Invariants specific to this component

None confirmed.


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

- GAP-8 (SPEC-00): needs a real read pass.
- `lit-actions/decrypt-signature.js` vs `shared/lit/actions/decrypt-for-respondent.ts` — possible
  duplication. Under DR-L4 each pool's action is generated with its constants baked in, so a static
  checked-in action is suspicious: either it predates DR-L4 or it serves a different purpose. Diff
  them before assuming equivalence.