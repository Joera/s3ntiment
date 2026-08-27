# SPEC-shared — `@s3ntiment/shared`

## What it is

The crypto/privacy plumbing library consumed by both frontends and the backend: EVM (viem,
permissionless Safe/simple account services), Lit (service + Lit Action source templates + access
control condition builders), Nillion (user-side nilDB client), IPFS (Pinata + Kubo), survey/
response/collection type factories, results scoring/tabulation, invite-card generation, and UI
assets (fonts/icons/CSS-in-TS design tokens, chart primitives). ~5k LOC, the largest single
component in the repo by design intent (everyone else is a thin consumer).

## Entry points (real contract — see INV-7 in SPEC-00)

| import path | surface | who uses it |
|---|---|---|
| `@s3ntiment/shared` (`.`, compiled) | everything under `src/shared/` (evm, lit, ipfs, nillion, survey, invites, results) | production builds of frontends/backend |
| `@s3ntiment/shared/dev` | same surface, uncompiled | dev-mode builds |
| `@s3ntiment/shared/browser` | `waap.service.ts` (WaaP/Silk wallet), `oprf/` (OPRF service), `graphs/` (D3-based chart primitives) | frontend-organiser, frontend-respondents only — browser globals (`window`), never safe to import from the backend |
| `@s3ntiment/shared/node` | `lit.key-storage.ts`, `lit.pool-keys.ts` | `nillcc-backend` only — Node-only key storage |
| `@s3ntiment/shared/assets` | fonts, icons, CSS-in-TS style modules, design tokens | frontends (styling) |
| `@s3ntiment/shared/components` | small vanilla-JS UI helpers (copy-hash, copy-link, copy-string, loading-spinner) | frontends |

`tsconfig.json`'s `include`/`exclude` only compiles `src/shared/**` and `src/node/**` into
`dist/` — `browser/`, `assets/`, `components/` are explicitly excluded from the TS build and
consumed as source (`.ts` directly) by Vite in the frontends. This means the backend can only ever
see the compiled `.` / `./node` surfaces; anything under `browser/assets/components` is
Vite-only.

## Key files

- `shared/lit/lit.service.ts` — `LitService`: thin REST client over Lit's account-key/usage-key
  API (`api.dev.litprotocol.com` / `api.chipotle.litprotocol.com`), not the `@lit-protocol/*` SDK
  used in `protocol/` (see SPEC-00 GAP-6). Handles PKP/group/action/usage-key management
  (account-key auth) and `encrypt`/`decrypt`/`executeAction` (usage-key auth, `decrypt` wrapped in
  `withRetry`).
- `shared/lit/actions/*` — Lit Action **source templates**, not code that runs in this repo. Each
  export is a function returning a JS string meant to be uploaded to Lit and executed inside its
  TEE: `encrypt.ts` (API-key-gated, no on-chain check), `decrypt.ts` (simple pool-member check),
  `decrypt-for-owner.ts` (pool-safe + Safe-signer check), `decrypt-for-respondent.ts`
  (pool-member check + signature verification). The `poolId`/`contract`/`safeAddress` are baked
  into the generated string via template literals at call time — not passed as `jsParams`.
- `shared/lit/accs.ts` — access-control-condition builders (`accsForPoolOwner`,
  `accsForPoolMember`, `alwaysTrue`) for the SDK-based ACC path; a separate mechanism from the
  on-chain-check-inside-the-action-code path used by `decrypt-for-owner`/`decrypt-for-respondent`.
  ⚠ UNVERIFIED which of the two gating mechanisms (ACC vs. in-action check) is actually load-bearing
  in the current flow — both exist in source.
- `shared/nillion/nilldb.user.service.ts` — `NillDBUserService`: the respondent-side nilDB client.
  `storeOwned`/`updateOwned` write with `owner: userDidString`, ACL granting the builder
  `read`+`execute` but never `write` (INV-1). Delegation tokens are fetched from the backend
  (`getUserDelegationToken`), never minted client-side.
- `shared/evm/viem.service.ts`, `permissionless.safe.service.ts`,
  `permissionless.simple.service.ts` — chain read/write wrapper and Safe/SMC (simple modular
  account, gas-abstraction) helpers. ⚠ Not read in depth this pass.
- `shared/survey/types.ts` — canonical `Survey`, `QuestionGroup`, `Question`, `SurveyAnswer`,
  `Batch`, `Pool`, `Config`, `EncryptedConfig` types. `EncryptedConfig` is the shape uploaded to
  IPFS: two independently Lit-encrypted blobs (`encryptedForOwner` with scoring,
  `encryptedForRespondent` without) plus a builder-only `encryptedScoring` string
  (see INV-6 in SPEC-00).
- `shared/results/scoring.factory.ts` / `tabulate.ts` — `stripScoring`, `calculateScore`,
  `isScored`, and result aggregation logic.
- `shared/browser/evm/waap.service.ts` — `WaapService`: wraps `@human.tech/waap-sdk` (Silk) for
  email/phone-based wallet creation with no seed phrase exposure; `createNillDBSeed()` derives a
  deterministic nilDB signer seed from a signed message, so the same WaaP login always resolves to
  the same nilDB DID.
- `shared/browser/oprf/oprf.service.ts` — ⚠ not read this pass; per prior chat history this is
  where "email → anonymous account, unrecoverable to the email" math (OPRF) is expected to live.
  Confirm before relying on this description.

## Shared surface consumed

N/A — this *is* the shared surface. See the entry-points table above for who consumes what.

## Invariants specific to this component

- Lit Action templates are **generated strings closed over pool-specific constants**, not
  parameterized at runtime — a new pool means new action source, a new CID, and a new
  `registerAction` call (see `PoolController.create` in SPEC-nillcc-backend). There is no single
  "the decrypt action" — each pool has its own compiled decrypt-for-owner and
  decrypt-for-respondent action.
- `compactAction()` (`lit/actions/helpers.ts`) minifies action source before hashing/uploading —
  any change to an action's whitespace-sensitive behavior (there shouldn't be any, but worth
  knowing) would need to survive this transform.
- `NillDBUserService.updateOwned` deletes-then-recreates rather than patching in place — matches
  `NilDBBuilderService.submitResponseForUser`'s same delete-then-recreate pattern on the builder
  side (see SPEC-nillcc-backend).

---

# Decision record

## Lit layer

### DR-L1 — Naga → Chipotle: access control moved from ACCs into action code
**When:** Apr 2026 (Chipotle announced; Naga sunset 30 days after Chipotle production).
**Decision:** Migrate to Lit Chipotle. Access control is no longer expressed as Access Control
Conditions evaluated by the network — it is **JavaScript inside the Lit Action, executed in a TEE
(Intel TDX)**, which reads the chain itself via `ethers.Contract` and returns `{ error }` if the
check fails.
**Why:** Lit replaced threshold cryptography across nodes with TEE execution. That removed the
coordination latency and cost, but it also moved responsibility: *you* now write the access check,
and it is only as correct as your code. Chipotle's other gains — HTTP-first, no SDK, on-chain KMS on
Base, Groups binding PKPs to permitted action CIDs — followed from the same shift.
**Consequence — the big one:** **you are responsible for writing correct access checks.** In Naga a
malformed condition failed closed at the network layer. In Chipotle a missing `if (!isMember)` just
decrypts. Review every action's guard clauses as security code, not plumbing.
**Superseded / now vestigial:** `shared/lit/accs.ts` (`accsForPoolOwner`, `accsForPoolMember`,
`alwaysTrue`) is the **Naga** mechanism. It is dead weight under Chipotle and should be deleted or
quarantined — see SPEC-00 GAP-6. Do not reintroduce ACC-style gating; it will silently do nothing.
Also superseded: `createAuthManager()`, `authSig`, session signatures, Capacity Credit NFT
delegation.
**Status:** current.

### DR-L2 — No SDK; raw `fetch` against the Chipotle REST API
**When:** Apr 2026, after checking whether a Chipotle npm package existed.
**Decision:** `LitService` is a hand-written REST client (`X-Api-Key` header, JSON bodies) against
`api.dev.litprotocol.com/core/v1` and `api.chipotle.litprotocol.com/core/v1`.
**Why:** there is no published Chipotle npm package. Lit's own guidance is HTTP-first, SDK-optional,
with an OpenAPI spec if you want to generate a client. The API is small enough that a thin wrapper
is less work than maintaining a generated one.
**Rejected:** the `@lit-protocol/*` packages (`lit-node-client`, `lit-client`, `auth`) — those target
Naga/Datil, not Chipotle. Installing them will look like it works and then fail at the network.
**Status:** current.

### DR-L3 — One group + one PKP per pool; the pool's Safe should own it (the walk-away test)
**When:** Apr 2026.
**Decision (target):** each pool gets its own Lit Group and its own PKP, and the **pool's existing
Safe becomes the Lit Account owner**. s3ntiment supplies only the action code (public IPFS CIDs) and
the frontend.
**Why — the walk-away test:** can a pool take its PKP and Group config, stop using s3ntiment, deploy
its own actions and keep operating on existing encrypted data? Under a platform-wide group: no.
Under per-pool sovereign ownership: yes. This is what makes "we literally cannot decrypt" a true
statement rather than a promise. Per-pool PKPs also give cryptographic isolation — compromising one
action still requires knowing which `pkpId` to target.
**Rejected:** **one s3ntiment-controlled Group containing every pool's PKP.** Easy onboarding (add a
PKP, done), but it makes s3ntiment the trust anchor, the governance bottleneck and the single point
of regulatory pressure — i.e. a platform. Explicitly killed against pillar 2.
**Accepted cost:** onboarding friction. A sovereign pool must deploy a Safe, create a Lit Account,
create a Group, register actions. Mitigation is tooling, not taking ownership back.
**⚠ Status: TARGET, not current.** The live code is the SaaS posture — `LitService` holds a single
s3ntiment account key (`VITE_LIT_API_ACCOUNT_KEY`) and `PoolController.create` provisions everything
under it. Under Chipotle there are no "modes": SaaS vs sovereign is an *emergent property* of who
owns the Account contract, so the migration path is real — hand the Account to the pool's Safe — but
it has not been walked. This is also what blocks GAP-5 (`PoolController.update` — "with what
authority?"): the answer is the pool's Safe.

### DR-L4 — Pool constants are baked into action source at generation time
**When:** Apr 2026.
**Decision:** `getDecryptForOwnerAction(poolId, contract, safeAddress)` and
`getDecryptForRespondentAction(poolId, contract)` return JS **strings** with the pool's values
interpolated. Each pool therefore has its own action source, its own CID, and its own
`registerAction` call.
**Why:** the CID is the security boundary. If `poolId` were a runtime `js_param`, any caller with a
usage key could pass a different pool's id and have the action check the wrong condition. Baking it
in means the permitted-CID list *is* the authorization: a group can only run the actions compiled for
its own pool.
**Consequence:** there is no "the decrypt action" — there are 2N of them for N pools. Changing an
action's logic means regenerating, re-hashing and re-registering per pool, which is precisely the
capability `PoolController.update` doesn't have yet (GAP-5). `compactAction()` minifies before
hashing, so the CID depends on the minified form.
**Status:** current.

## Identity layer

### DR-I1 — WaaP (Human Wallet) as the wallet/identity provider
**When:** Dec 2025, revisited Apr 2026 against Lit's own Stytch-based option and Privy.
**Decision:** `@human.tech/waap-sdk` (Silk) — email/phone login, no seed phrase, key derived
client-side from a threshold OPRF over Human Network plus a security share held in a Silence Labs
TEE (2PC signing).
**Why:** philosophically aligned — the user holds the key material, nobody custodies it, the model is
free (no platform fee), and it's in the same "Human" ecosystem as the identity primitives.
**Rejected:**
- **Fireblocks** — enterprise-proven, but custodial-flavoured, expensive, and the wrong story for
  pillar 2. Noted as a reconsider-if-we-become-enterprise-SaaS option only.
- **Privy** — battle-tested (75M accounts) but acquired by Stripe in 2025; same "trust a company"
  profile.
- **Lit's own Stytch-derived TEE wallet** — would make Lit both the key layer *and* the access layer.
**Known trade-off, recorded honestly:** the OPRF input is low entropy (an email address). Security
rests on (a) the Human Network threshold holding — compromise enough nodes and *every* email's
sovereign share is derivable — and (b) the Silence Labs security share. This is materially weaker
than a high-entropy seed phrase, and it is a deliberate UX-for-entropy trade.
**Status:** current. `createNillDBSeed()` in `waap.service.ts` derives the nilDB signer seed
deterministically from a signed message, so one WaaP login always resolves to the same nilDB DID.

### DR-I2 — Human Network personal-data nullifiers: ABANDONED
**When:** proposed Oct 2025, dropped by Feb 2026.
**Original design:** the respondent entered personal data (name, date of birth, city of birth), a
VOPRF over Human Network turned it into a nullifier, and that nullifier was the sybil-resistance
mechanism — "same person, same nullifier, blocked duplicate".
**Why abandoned:** it required collecting personal data from every respondent to *prove they hadn't
participated* — the exact inversion of pillar 1. It also made participation contingent on Human
Network availability at registration, and the "one identity per person" property was weaker than it
looked (same person, different inputs, different nullifier).
**Replaced by:** DR-C1 — the nullifier is carried on the card and signed by the batch wallet.
Sybil resistance comes from *invitation scarcity plus on-chain burn*, not from identity.
**Status:** SUPERSEDED. Do not reintroduce personal-data-derived nullifiers.

### DR-I3 — Deferred WaaP login (card-derived signer first): EXPLORED, NOT ADOPTED
**When:** Mar 2026.
**Proposal:** let a respondent answer their first survey with a keypair derived from the card
nullifier alone, register in the pool with that, and only sign in with WaaP afterwards — binding the
WaaP signer to the SMC for return visits. Motivation was pure UX: remove the wallet step from the
first-run funnel.
**Why not adopted:**
- **Nullifier reuse as key seed** — the nullifier is already the one-participation proof. Using it
  additionally as a key-derivation seed means a photographed or leaked card yields the respondent's
  signing key, not just a spent invitation.
- **The linkage problem** — visit 1 identity (`hkdf(nullifier)`) and visit 2 identity
  (`hkdf(waap_secret)`) must be provably the same respondent, which requires storing a card→WaaP
  binding somewhere. On-chain leaks the link; in nilDB puts it behind the very access control the
  key was meant to unlock.
**Status:** EXPLORED, not adopted. Current flow requires WaaP up front. If first-run friction comes
back as a problem, re-read this before re-proposing — the nullifier-as-seed leak is the blocker.

## Nillion layer

### DR-N1 — The builder key pays; the builder is never the ACL grantee for write
**When:** Feb 2026.
**Decision:** Separate *paying for storage* from *reading data*. The builder key holds the nilDB
subscription, creates collections and mints NUC delegations. The survey owner's key reads results.
When a respondent writes, the ACL grantee is the **survey owner**, never the builder, and `write` is
never granted to anyone but the owner of the record.
**Why:** it makes "we pay for the infrastructure but cryptographically cannot read your answers" a
structural fact rather than a policy. Only the builder key needs funding, which keeps operations
simple.
**Status:** current as *intent*, and correct in `storeOwned`. See DR-N2 and GAP-10 for how the live
path diverges.

### DR-N2 — Owned collections → standard collections (TEMPORARY)
**When:** Feb–Mar 2026, after repeated integration failures.
**Decision:** Survey collections are created with `type: "standard"`, and responses are written by
the **builder** on the respondent's behalf via `POST /api/surveys/:id/submit` →
`submitResponseForUser`. `NillDBUserService.storeStandard` is the live client path.
**Why:** owned collections did not work. `SecretVaultUserClient.createData` always routes to
`/v1/data/owned`, which 404s or fails validation against a standard collection; switching the
collection to `type: "owned"` then hit a different wall (`DocumentNotFoundError`, node-side
validation rejecting the document shape). Nillion's own `llm.txt` says it plainly: *for fullstack
apps use standard collections; owned collections aren't fully supported yet.*
**Rejected (for now):** the owned-collection path — `storeOwned`, `owner: userDidString`, ACL
granting the builder read+execute only. **The code is still there and still correct.**
**⚠ Cost, stated plainly:** this is the biggest live contradiction in the system. The respondent no
longer holds their record; the builder writes it into a builder-owned collection. "Respondents own
their data, can edit and delete it" is currently true *operationally* (the API honours it) but not
*cryptographically* (nothing stops the builder). Pillar 1 layer 3 — "your data is never whole in one
place" — is weakened accordingly.
**Exit condition:** when Nillion's owned collections stabilise, flip the client back to `storeOwned`
and create collections with `type: "owned"` and `owner: userDidString`. Both code paths are
deliberately retained for that reason — **do not delete `storeOwned` as dead code.**
**Status:** current, TEMPORARY. See Q4.

### DR-N3 — Delegation without ownership is a "convenience trap"
**When:** Feb 2026.
**Finding:** if the builder owns the collection and the survey owner's access is a delegation token,
then when the builder disappears the delegation expires and the owner is **locked out of their own
results permanently**. Delegation is a convenience layer, not a sovereignty mechanism — it fails the
walk-away test outright.
**Resolution reached:** the collection should be owned by the survey owner, with the survey owner's
nilDB private key encrypted to them (Lit) so they can recover it and, if needed, pay for their own
subscription and carry on without s3ntiment. The builder proxies while it exists, but ownership never
depends on it.
**⚠ DRIFT (GAP-10):** the code does the opposite. `createSurveyCollection` passes
`owner: this.builderDid.didString`. Combined with DR-N2 the current state is builder-owned collection
*and* builder-written data — precisely the trap this DR identified. `getOwnerReadDelegation` (365-day
delegation, policy-scoped to one collection) is the convenience layer, with no ownership underneath.
**Status:** resolved on paper, not in code. Highest-value item to close for pillar 2.

## Gaps / open questions

- `permissionless.safe.service.ts` / `permissionless.simple.service.ts` (SMC/gas-abstraction layer)
  — ⚠ UNVERIFIED, not read in depth. This is the layer the contract leans on for identity resolution
  (`ISMC(msg.sender).owner()`, DR-C6), so it is the priority for the next read pass.
- `oprf.service.ts` — ⚠ UNVERIFIED. Expected to hold the email→anonymous-account derivation described
  in DR-I1; confirm the actual flow before repeating that description anywhere public.
- `shared/lit/accs.ts` — confirmed Naga vestige per DR-L1; delete or quarantine (GAP-6).