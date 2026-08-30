# HANDOFF — Identity Architecture & Deferred Persistence (2026-08-28)

**Purpose:** Self-contained handoff so a fresh session (human or agent) can pick up the s3ntiment
identity work with a new context window. Read this + the linked state-of-record files; nothing else
in prior conversation is required.

**Author/Creator:** s3n-orchestrator (DeepSeek V4 Flash 0731, orchestrator role, Venice.ai).

---

## 0. TL;DR — where we are

The s3ntiment identity design has settled on an **anchored-identity model**: a durable, app-independent
**anchor** identity deterministically derives unlinkable per-context **stealth leaves**; the leaf is what
registers on-chain and gates survey access; rotation = re-derivation; recovery = re-derivation from the
anchor. This supersedes the earlier "random ephemeral key `E` → rotate to WaaP-derived `D`" framing.

**Next task in flight:** an explore sub-agent is analyzing the actual ERC-1056 `EthereumDIDRegistry`
Solidity to extract **authority/authorization patterns** (owner mapping + ECDSA-recover-to-determine-actor,
revoke-before-activate) to inform the design of *our own* contract method guards. The user wants to start
with **the contract methods**, reading ERC-1056's Solidity as a reference (NOT adopting the did:ethr
standard, and NOT for on-chain rotation — rotation is re-derivation).

---

## 1. Session / worker roster (preflight facts)

- **This orchestrator cannot write code.** All coding/investigation/review is delegated to sub-agents via
  `sys_session_send`. Orchestrator authors only non-code text (docs, skills, Markdown).
- **`builder`** — AVAILABLE. Runs in PI harness as model **omnigent/deepseek-v4-flash-0731**. It is the
  sole implementer/reviewer/explorer. Reserve for implement + review + explore dispatch.
- **`solaris`** — **UNAVAILABLE.** Not on PATH on this machine (confirmed by roster preflight). Do NOT
  dispatch to it; it will fail to boot. Re-check `command -v pi`-style preflight only if asked.
- **Dispatch rules:** every `sys_session_send` sets `title` (prefix with model alias, e.g.
  `v4flash-explore-...`) and `args.purpose` ∈ {implement, review, explore/search}. Sub-agents are
  autonomous; results arrive in the inbox. Only the implementer opens a PR; the human merges; the
  orchestrator never merges. Independent review = fresh session given ONLY diff + contract.
- **Reporter convention (docs-conventions.md):** sub-agent writes full report to a file, inline reply
  1–3 lines. Explore/search findings → `brain/audits/`; review verdicts → `brain/reviews/`.
- **Recurring harness quirk:** sub-agent "completed" notifications are frequently premature. Always verify
  the report file exists (or use `sys_session_get_info` / `sys_session_get_history`) before trusting, and
  set hedge timers (`sys_timer_set`) rather than polling. A session showing fresh `last_activity_at` with
  an absent report is still working — wait, don't re-dispatch.

---

## 2. Project context

- **Repo:** `~/code/s3ntiment` (main local HEAD `b10cb7d26`; origin/main merged `cfd8cf255`).
- **Worktrees:** under `~/code/worktrees/<repo>-<task>` (e.g. `s3ntiment-contract-tests`,
  `s3ntiment-owned-merge`, `s3ntiment-ht-respondent-auth-tests`, `s3ntiment-shared-encoding`,
  `s3ntiment-abi-snapshot`). They are ephemeral scratch; deliverables = branch + PR.
- **Brain (state-of-record):** `~/code/s3ntiment/brain/` — `specs/`, `audits/`, `reviews/`, `code-map/`,
  `docs-conventions.md`, `whitepaper/`.
- **Product:** a privacy-preserving survey/panel platform on **Nillion** (SecretVaults owned collections,
  `owner = did:key`). Respondent identities currently require on-chain registration before answering —
  the funnel blocker this work removes. Key invariants: **INV-2** (one on-chain write per respondent per
  pool), **INV-3** (identity resolves through a per-pool key, no master identity), **promise 2** (access
  via email without storing the email).
- **Stack facts (verified):** `@nillion/secretvaults@3.0.0` (root override), `@nillion/nuc@2.0.1`,
  `nildb` server `NillionNetwork/nildb`. Owned-collections merge (2026-08-27) made `storeOwned` the live
  write path; per-pool PKP is collection owner; **GAP-10 resolved**.

---

## 3. The anchored-identity model (the design, settled)

Two layers — deliberately named to avoid "private"/"sovereign" confusion:

- **Anchor identity (durable layer):** a seed phrase / hardware key / external on-chain address held
  **independently of the app and its local storage**. Its whole purpose is **app-independence**:
  recovery + portability. It **never appears on-chain itself**, and never lives only in app-local storage
  (the app must not hold the crown jewel).
- **Stealth identity (leaf layer):** **deterministically derived** from the anchor, **one per context**,
  **unlinkable** (`leaf_i = KDF(anchor, context_i, purpose="stealth")`). On-chain presence is expected and
  *safe* because a leaf cannot be reversed to the anchor and per-context leaves don't correlate. "Stealth"
  not "private": it acts on-chain.

**Why on-chain registration is safe:** the thing registered is the **leaf**, never the anchor; leafs are
anonymous, per-context, freshly derived. The old objection ("public identity near a contract leaks
privacy") is resolved by separation: the anchor never touches the contract, the leaf carries no identity
signal that points back.

**Rotation = re-derivation** (derive a fresh leaf, migrate records — no on-chain ceremony).
**Recovery = re-derivation from the anchor** (anchor IS the recovery backstop — no recovery shares/social
guardians needed for the private layer).

**What was rejected (deliberately simplified):** the general key-rotation ceremony from prior art —
KERI key-event-log + pre-rotation + witnesses, SSS/SLIP-0039 t-of-n recovery shares, ERC-1056 `did:ethr`
for Nillion. Rationale: derivation from the app-independent anchor already delivers recovery, rotation,
portability and unlinkability with a single KDF; the ceremony duplicates the anchor's job at ceremony cost.
The **one general lesson kept:** separate the *stable identity* from the *operational keys*.

**Nillion constraint (accepted):** `_owner` is an immutable `did:key`; there is **no ownership transfer**.
Migration on rotation = **ACL-grant** (`POST /v1/users/data/acl/grant|revoke`, `$push/$pull` on `_acl`,
document-scoped, owner-only, grantee must be a registered builder) for access continuity, or
**delete+recreate** (the existing `updateOwned` pattern) for a real ownership move. **Q1 resolved**
(2026-08-28): no ownership transfer exists; this was the formerly-blocking gate.

---

## 4. State-of-record files (read these to ground the next session)

> Note: **`brain/audits/erc1056-authority-pattern-2026-08-28.md`** was added to the archive after the v1
> handoff (see §5) — the ERC-1056 authority idiom to borrow for the contract methods, with the
> keys/keyType-vocabulary correction.

- **`brain/specs/RFC-deferred-identity-persistence.md`** — **THE design doc, just rewritten v2 (2026-08-28)**
  around the anchored-identity model. Sections: summary; motivation; DR-I3 relationship; the model
  (§4); persist flow + two populations (§5); what we dropped + why (§5.3); Nillion constraint + Q1
  resolved (§6); costs/leak analysis (§7); decisions (§8); open questions Q1–Q6 (§9); split fallback
  (§10); change list (§11); audit trail (§12).
- **`brain/audits/ownership-rotation-research-2026-08-28.md`** — did:key owner immutability, no transfer;
  delete+recreate = `updateOwned`.
- **`brain/audits/acl-grant-existing-owned-docs-2026-08-28.md`** — ACL `$push/$pull` grant/revoke mechanics.
- **`brain/audits/didethr-rotation-2026-08-28.md`** — NUC did:ethr is address-as-signer (refuted).
- **`brain/audits/rotation-primitive-prior-art-2026-08-28.md`** — KERI/DID/recovery prior art; the general
  ceremony we reduced to anchor→stealth derivation.
- **`brain/docs-conventions.md`** and the dispatch-conventions skill
  (`~/.omnigent/agent-configs/s3n-orchestrator/skills/dispatch-conventions/SKILL.md`) — operating rules.
- Other audits present: `gap-verification-2026-08-27`, `branch-merge-analysis-2026-08-27`,
  `2tokens-hardcoded-pools-2026-08-27`, `ht-respondent-auth-exploration/tests-2026-08-28`,
  `seam-coverage-exploration-2026-08-28`, `shared-encoding-2026-08-28`, `abi-snapshot`.

---

## 5. State of the ERC-1056 explore (COLLECTED at handoff)

**Explore `v4flash-explore-erc1056-authority-pattern`** (session `57c4f97ef60c4149899bc5335d2f7805`,
`builder`, purpose explore) — **COMPLETE.** Report landed and is archived at
**`brain/audits/erc1056-authority-pattern-2026-08-28.md`** (was `/tmp/research-erc1056-registry-sol.md`).
Read it before designing the contract methods (§7). Headline findings:

- **CRITICAL CORRECTION:** the `keys`/`keyType`(1/2/3/4)/`recoverAddr`/`ecverify`/`_addDelegatedKey`
  vocabulary in the prior dispatch brief does **NOT** exist in the canonical reference implementation
  (`uport-project/ethr-did-registry`, deployed `0xdca7ef03e98e0dc2b855be647c39abe984fcf21b`). It belongs
  to an early EIP-1056 draft/uPort keys-lineage that was superseded before merge. Do **not** port that
  vocabulary.
- The shipped registry is **delegate-based**: `owners[identity]`, `delegates[identity][delegateType][delegate]`
  → `validTo` (unix ts), `onlyOwner(identity,actor)` modifier, `identityOwner()` default-to-self, per-owner
  `nonce`, and **`ecrecover` "signed-hash meta-authorization"** (an off-chain signer authorizes a change
  without being `msg.sender`). That is the certificate pattern to borrow for OUR method guards.
- **BORROW:** owner/authority mapping + explicit authorization; ECDSA-recover-to-determine-actor (the
  `ecrecover` signed-hash idiom); revoke-before-activate ordering; `validTo`/`nonce` fields if we need
  delegated action keys. **DROP:** DID-registry resolver surface, public-DID-doc keying, on-chain rotation
  (re-derivation handles it). The report has a concrete "what OUR contract should adopt" section.

---

## 6. Key open questions (see RFC §9)

- **Q2** — Merge/re-registration semantics: a freshly re-derived leaf that is already a pool member.
- **Q3** — Was the original blocker wallet *setup* or *transaction latency*? Determines whether the model
  alone fixes the funnel. Answer before implementation.
- **Q5** — Derivation `context` granularity (per pool is the INV-3 floor; finer granularity = more on-chain
  registrations).
- **Q6** — Anchor-creation UX for the anchor-less population (this is the persist step's real friction).
- **(resolved) Q1** — No Nillion ownership transfer; ACL-grant / delete+recreate are the accepted mechanics.

---

## 7. Recommended next step — the contract methods

> **CORRECTION (2026-08-30, Task 2 planning):** The stance below — *"deliberately no
> `changeOwner`/`rotateMember` in the method surface; rotation = off-chain re-derivation →
> re-register a fresh leaf"* — was based on an assumption that turned out to be false and is
> **SUPERSEDED for Task 2.** The assumption was that registering the fresh derived leaf at persist
> was achievable (RFC §7.3 even budgets it as "the second transaction"). In the actual contract the
> **only** registration function, `registerInPool`, is **card/nullifier-bound** and the entry card is
> already spent → registering a fresh derived S with it reverts `NullifierAlreadyUsed`
> (`S3ntimentSurveyStore.sol:454`). There is **no nullifier-less member-add / no changeOwner / no
> rotate**. So the off-chain-rotation stance leaned on a registration seam that does not exist.
> **Task 2 therefore requires a self-authorizing on-chain swap** — the user's `rotateMember(poolId,
> newLeaf)`: called while the acting leaf is still E (SMC owner = E), contract requires
> `poolMembers[poolId][owner] == true`, then atomically `poolMembers[poolId][E] = false;
> poolMembers[poolId][S] = true`. Authorization = only E's keyholder can drive the SMC whose owner is
> E (optional ERC-1056 `ecrecover` + nonce/expiry hardening per the audit idiom). This also cleans up
> the returning-user orphan E2. NOTE: the contract swap moves **membership only** — the nilDB
> E→S record migration (per-leaf immutable `did:key` owner; RFC §6) is still required separately.
> This is the concrete mechanism for the RFC §7.3 second transaction and resolves the RFC §11
> "add nothing for rotation" tension; record an RFC amendment with the rotate PR.

All the rest of §7 below is written under the old (now-superseded) rotation stance; keep it for
the ERC-1056 authority idiom, but do not treat "no rotate method" as current for Task 2.

User direction: **start with the contract methods**, and *read the ERC-1056 registry Solidity as a
reference for how to rotate/authorize an address* (not the standard, not Nillion — just the pattern). Two
reconciliation points to hold when designing:

1. **The anchored model's contract does NOT need on-chain rotation.** Rotation is re-derivation
   (off-chain) → re-register a fresh leaf. There is deliberately **no `changeOwner`/`rotateMember`** in the
   method surface. Do not let the ERC-1056 example drag rotation ceremony on-chain.
2. **Borrow the authority idiom, not the rotation semantics.** What transfers from ERC-1056 to OUR
   `S3ntimentSurveyStore` method guards:
   - owner/authority mapping + explicit authorization for privileged calls;
   - **ECDSA-recover-to-determine-actor** (prove *who* is allowed to make a privileged call);
   - revoke-before-activate ordering;
   - key-metadata struct (type/ttl) if we ever need delegated action keys.
   Drop the DID-registry resolver surface and the public DID-document keying.

Expected minimal contract surface (given rotation = re-registration): `registerInPool` (with nullifier
burn, paymaster DR-C6), `isPoolMember` (the SINGLE access predicate — no second authorization path per
DR-L1), plus any privileged store methods guarded by the borrowed authority idiom. **If any contract
change ships, note `S3ntimentSurveyStore` currently has NO test coverage in the source share** — a
new authority-bearing function should not ship without a test (a `contract-tests` worktree exists but is a
separate, already-merged change).

**Implementation workflow:** the actual coding / contract work goes to a `builder` sub-agent in its own
worktree (`~/code/worktrees/`), opens its own PR; the human merges; independent review in a fresh session.

### §7.1 STATUS — D3 shipped & merged (2026-08-28)

**D3 of `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md` is LANDED.** PR #9
(`deepseek/method-surface`, **MERGED** 2026-08-28, merge commit `f23d0dfd`) centralizes the Safe
authority check into a single choke-point. Implementation detail vs. the spec: the choke-point is an
internal **function** `_requirePoolSafe(string memory poolId) internal view` (`PoolNotFound` →
`NotPoolSafe`), **not** a Solidity `modifier` — this repo's Solidity resolves modifier reference-type
params to `calldata`, so a `string memory` modifier can't be invoked with memory strings (and args
can't be `calldata` without breaking the zero-ABI-change constraint). It preserves the contract's
INTENT (single choke-point, zero external ABI/selector change, bootstrap branch preserved, ordering
kept). Gate reconciled by orchestrator at committed HEAD `50f71b46a`: **36 passing**. Test suite
coverage claim in §7 above ("NO test coverage") is **stale** — see spec §8.

**§5-A (`revokeMember`) — implemented, reviewed, AWAITING HUMAN MERGE (2026-08-29):** PR #17
(`deepseek/revoke-member`, commit `7ee6769dc`) adds the Safe-gated prune
`revokeMember(poolId, member) external` routing through `_requirePoolSafe`, setting
`poolMembers[poolId][member] = false`, idempotent (no-op on already-unregistered), plus a 5-test block.
Gate reconciled by orchestrator at committed HEAD: **41 passing** (36 prior + 5 new). Independent
review (builder, fresh session) **PASSES — no blocking** — verdict archived at
`brain/reviews/revoke-member-2026-08-29.md`. **Ready for the human to merge; orchestrator does not merge.** §5-B
`registerInPoolSigned` remains **deferred** (no paymaster/relayer path defined; would add `nonce` storage).

**card-v2 (audit #1/#6/#7) — implemented, reviewed, MERGED (2026-08-29):** PR #19
(`deepseek/card-v2`, commit `77957f281`, based on `origin/main` @ `e18a8374c`) is a **BREAKING card-format**
change, scope-limited to exactly three external-audit findings. New card digest **`keccak256(abi.encode(
poolId, nullifier, batchId, address(this), block.chainid))`** — binds pool (#1), contract + chain (#6);
`abi.encode` (not `encodePacked`) required now that `poolId`+`nullifier` are both dynamic. Nullifier storage
scoped per pool: `mapping(string => mapping(bytes32 => bool)) usedNullifiers` keyed `[poolId][messageHash]`.
Zero-address owner guard (#7): `registerInPool` reverts `InvalidMemberAddress()` when `ISMC(msg.sender).owner()`
== `address(0)`, before the membership write (tx rollback undoes the burn). ABI: `isNullifierUsed` gains a
`string poolId` param (intentional); `registerInPool` external signature unchanged; new error
`InvalidMemberAddress`. The off-chain encoder `shared/src/shared/invites/encoding.ts` is the single source of
truth and byte-identical to on-chain via `encodeAbiParameters('string,string,address,address,uint256')`
(pinned by `contracts/test/encoding.seam.test.ts` oracle round-trip; independent canary recomputed and
matched). Gate reconciled by orchestrator at committed HEAD: **50 passing** (baseline 46). Independent review
(builder, fresh session) **PASSES — no blocking** — verdict archived at
`brain/reviews/card-v2-2026-08-29.md`. **MERGED by the human 2026-08-29** (breaking card-format change —
old-card digests no longer verify; nothing printed pre-merge is affected). Findings
#2, #3, #5, #9, #10 remain **dropped/deferred** per the proportional survey-product triage.

**revoke-batch (audit #4 + #8 + #9) — implemented, reviewed, AWAITING HUMAN MERGE (2026-08-29):** PR #20
(`deepseek/revoke-batch`, feat commits `d19f9cd0d` + `056b8f2c0`, docs `9f0ba864c` + `677067cb6`, based on
`origin/main` @ `a197684bc`). Re-scoped findings folded into ONE PR. **#4:** `Batch` struct gains `revoked`
(bool) + `maxCards` (uint256, 0=unlimited) **end-appended** (storage-layout-compatible); new Safe-gated
`revokeBatch(poolId, batchId)` and `setBatchMaxCards(...)` (**additive**, no existing ABI change), both routed
**exclusively** through the `_requirePoolSafe` choke-point; `registerInPool` now reverts `BatchRevoked()` /
`BatchMaxCardsReached()` **before** any nullifier burn or membership write (leaked batch key can be surgically
retired + capped without destroying the pool). **#8:** `updateSurvey` reverts on empty CID (mirrors
`createSurvey`'s guard). **#9 (folded in):** `createSurvey`'s existing-pool branch reverts `InvalidBatchIds()`
when `batchIds.length > 0` (the array was previously dropped silently on an existing pool — survey added,
batches never registered, cards later failing `BatchNotFound` at redemption); new-pool bootstrap branch
untouched. Gate reconciled by orchestrator at committed HEAD `677067cb6`: **61 passing** (was 50). Independent
review (fresh builder sessions, report-only, diff + contract only) **PASSES — no blocking** across #4/#8/#9 —
verdict archived at `brain/reviews/revoke-batch-2026-08-29.md` (+ addendum). **Ready for the human to merge;
orchestrator does not merge.** Findings #2, #3, #10 remain **dropped/deferred** (proportional survey triage).
**#5 Safe rotation dropped permanently** — the Safe wallet already self-manages owners via its own upgrade
path, so an on-chain transfer/accept flow in the store would be redundant surface.

**RFC-deferred-identity-persistence — Task 1 (move account creation: extract human wallet + random
bootstrap leaf E) — implemented, reviewed, READY FOR HUMAN MERGE (2026-08-29):** PR #21
(`deepseek/deferred-identity-bootstrap`, commit `cb39968b0`, based on `origin/main` @ `a197684bc`).
**(A)** human-wallet flow (WaaP login → OPRF `getSecp256k1` → `updateSignerWithKey`) extracted from
`auth.factory.ts` into standalone callable **`humanWallet.factory.ts`** (kept for the LATER post-survey
persist route; **no longer called at entry** — all three entry callers converted). **(B)** at entry the
frontend-respondents app now bootstraps a **random stealth leaf `E`** via `generatePrivateKey()` from
`viem/accounts` (CSPRNG; no anchor, no OPRF/PRF), **persisted to localStorage immediately** (new
`BOOTSTRAP_STORAGE_KEY='bootstrapE'` + load-or-create `ensureBootstrapKey()`), set on the account signer
via `updateSignerWithKey` (so `E` = SMC signer + nilDB owner). Entry gate semantics changed to
"ensure E exists + persisted" (E is pre-registration at entry per RFC §5.2/§8); eager
`waap.createWallet`/`oprf.init` deferred out of `services.ts`; `waap.logout` preserved. Gates reconciled:
`@s3ntiment/shared` tsc build green (0 errors), `frontend-respondents` vitest **113 passing (11 files)**,
vite build green. Independent review (builder, fresh session, diff + contract only) **PASSES — no
blocking** — verdict archived at `brain/reviews/task1-pr21-review-2026-08-29.md`; NON-BLOCKING carry-forward
for the persist task (N1–N5): **N1** wipe `bootstrapE` after E→S re-derivation (raw key is XSS/device-readable
by design, RFC §8.2); **N2** `used-card-ctrlr` "Sign in" no longer verifies membership (acceptable now;
revisit for returning anchors when persist lands); **N3** `auth-ctrlr` always re-registers (touches open
RFC Q2 idempotency); **N4** persistence is best-effort (setItem failures swallowed — optional to surface);
**N5** style: `IServices` import lacks explicit `.js` extension. **Ready for the human to merge; orchestrator
does not merge.** Task 2 (post-survey persist route that calls the extracted human-wallet factory to add an
anchor, derive the fresh stealth address, and rotate docs + registration on contract) is NOT started.

---

## 8. Roster/conventions reminders for the picking-up session

- Preflight the roster (`command -v pi`) on your FIRST turn before dispatching, but do it *silently* and
  don't end the turn on it.
- `builder` only. `solaris` (qwen3.8-27b, self-hosted) DID boot in the 2026-08-29 run but proved
  unreliable for review: it ran ~20 min with zero tool calls / stale `last_activity_at` after the dispatch
  and had to be cancelled. Prefer `builder` for reviews too; only use `solaris` if it shows real activity.
  One task at a time per session; parallel tasks = separate titled sessions.
- Act in the same turn you announce. Dispatch + hedge-timer in the same turn; then wait for the inbox
  (auto-wake). Never poll with timers; timers are for hedge/re-probe with genuinely-absent reports.
- All code → sub-agent. This handoff and the RFC are orchestrator-authored docs (fine).

---

<<<<<<< HEAD
## 9. Task 2 — "Secure your stealth account" (design refinement + returning-invite analysis, 2026-08-30)

**Author:** s3n-orchestrator. Addendum capturing the Task 2 (post-survey persist) design as the
user refined it, plus a read-only exploration of the returning-invite merge case. Task 2 remains
**NOT implemented** — only design + analysis exist.

> **GOVERNANCE LESSON (2026-08-30):** The ERC-1056/did:ethr "follow or not" deliberation pushed the
> design to be defined by *opposition* to a reference standard, which conflated two distinct things
> and led to a decision that stopped honoring the original goal. The ceremony we rightly dropped
> (key-event logs, witnesses, revocation books, DID-doc keying) was treated as one with the minimal
> on-chain membership swap the product actually needs — so "no rotateMember" was chosen as a
> statement *about a standard*, not as an answer to *"what does the persist/account flow need from
> the contract?"* Real rule going forward: **evaluate each primitive against the product goal, never
> by its resemblance to (or distance from) a reference standard.** "Do we follow X?" is a bad lens;
> "does the flow need this, and is it still minimal?" is the good one.

### 9.1 The reframe (user, 2026-08-30)

Task 2 is **"secure your stealth account," NOT "join."** Because PR #21 already makes a respondent a
pool member at entry (bootstrap `E` registers like any leaf), there is nothing left to *join*. The
UX:

- The CTA lives on the **results/survey-complete page**, for the anchor-less population only (RFC §5.2
  step 4–5).
- Copy (user-approved): *"The keys for your stealth account are stored in this app. If you lose or
  reset this device, your account is permanently lost."*
- Trigger state: a localStorage signal that means "has this device secured?" — user proposed
  `secure_account: boolean` / `rotated_keys` / `anchor_address: string`; when **undefined/false →
  show the CTA**. Explore confirmed **none of these keys exist today** (Q4 below).
- CTA button → **`/secure` route** which offers options. Placeholders (user will fill in later):
  1. email + human wallet (the `humanWallet.factory.ts` from PR #21 / Task 1a)
  2. railgun *(placeholder)*
  3. nihilium *(placeholder)*

### 9.2 Flag recommendation (orchestrator)

Prefer `anchor_address: string` (or anchor identifier) as the single source of truth, written **only
once the E→S rotation fully succeeds** (register S → migrate records → wipe E = N1); `undefined` =>
show CTA. Avoid a free-floating boolean that can drift from reality. The flag records "*this device
secured*," NOT recovery material — it does NOT contain the anchor key, so it cannot silently re-derive
S (recovery requires presenting the anchor → human-wallet/WaaP auth). Nuance: after recovery on a fresh
device, localStorage is empty so the CTA would show even though recoverable — decide whether to mark
secured on re-derivation.

### 9.3 Returning-invite merge — analysis (explore `v4flash-explore-returning-invite-merge`,
session `eaf5d7a28163480abdba355bbb12ac9b`; report `brain/audits/returning-invite-recovery-2026-08-30.md`)

Scenario: user secured in pool P (anchor A → leaf S, records under S). Later re-invited to SAME pool P
with a DIFFERENT nullifier N2, on a fresh device → entry bootstraps random E2 and registers it
(N2 burned), then at the end the user reveals A and re-derives S (already a member). Findings:

- **RFC Q2 resolves to REVERT.** `registerInPool` reverts `AlreadyPoolMember()` on an existing member
  and the revert rolls back the whole tx (nullifier NOT consumed) —
  `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:466`, test `contracts/test/S3ntimentSurveyStore.test.ts:1270`.
  Recovery must therefore be **re-derivation, not re-registration** (RFC §4.5). No contract change needed.
- **Access is gated solely by `isPoolMember(leaf)`** — no per-survey/batch authorization (RFC §8.1;
  Lit `decrypt-for-respondent.ts:19-28`, backend `main.ts:184-189`). So redeeming N2 as E2 grants E2
  nothing S doesn't already hold — it only burns N2 + creates an orphan E2 member/record set.
- **Re-deriving S recovers everything natively with zero on-chain writes:** deterministic leaf →
  same did:key → same Nillion seed (`createNillDBSeed`) → S's membership + records come back (§4.6).
- **E2→S migration does NOT exist.** Records are per-leaf (`did:key` from leaf). Only a same-owner
  delete+recreate `updateOwned` exists (`nilldb.user.service.ts:69-75`, **no production call site**).
  Real options = ACL-grant wrapper (`POST /v1/users/data/acl/grant`, raw endpoint, not wrapped) or a
  two-client delete+recreate (both E2+S keys live in one session). Both are **to build** (RFC §11
  "record migration helper for leaf→leaf", still unimplemented).
- **No silent returning-anchor detection:** no `anchor*`/`secure_account` key exists; human-wallet
  anchoring (`humanWallet.factory.ts:17-25`) needs interactive WaaP login (the prompt deferred identity
  removed) and is deliberately not at entry. So recovery at the START would re-add an auth prompt.

**Design conclusions (orchestrator):**
- Recover at the **END** (the secure step doubles as recovery) — preserves frictionless entry that Task 1
  exists to protect; silent recovery isn't available (see above). Reopens RFC Q3 if start-recovery is
  considered.
- **Avoid spawning E2 for returning anchors** when feasible — if the user recovers S at entry, skip
  bootstrapping E2 entirely; redeeming N2 against an existing member reverts anyway, so N2 is simply
  left unburned and the user proceeds as S (no migration needed).
- The E2→S migration helper is still worth building per RFC §11 (needed for re-secure/rotate), just not
  as the hot path of this scenario.
- **Open product question** (ranks above the timing call): if access = `isPoolMember(S)` alone, what is a
  second invite actually *for* when S is already a member? If new surveys need re-inviting per round, that
  is the operator controlling participation — confirm before over-engineering the merge.

**Task 2 implementation is NOT started.** Next when the user confirms the open design points
(flag representation; what railgun/nihilium establish; the second-invite purpose): decompose
Task 2 (results-page CTA + `/secure` route + anchor step + E→S rotate + wipe E) → explore the precise
seams → implement in fresh worktree (PR #22) → independent review → human merge.

### 9.4 Two-case recovery model + `/account` route (user decision, 2026-08-30)

User resolved the start-vs-end recovery question into a two-case model with **no pre-survey questions
in either case**, and a dedicated **`/account` route that replaces `/secure`**:

- **Case 1 — new invite, app still has stealth + anchor state (same device):** recover at START,
  **silently** (reuse existing on-device state — not a prompt). Requires persisting the **derived leaf
  `S`'s key locally** (plus the `anchor_address` flag) so entry can reuse S without re-derivation/re-auth.
  Consistent with RFC §8.2 (app holds derived leaves; only the anchor is app-independent) and with N1
  (wipe the *bootstrap* E, keep the *derived* S). XSS/device-readability caveat accepted (N1 backdrop);
  the anchor remains the portable recovery backstop for a lost device.
- **Case 2 — new invite, clean app (fresh device / cleared storage):** bootstrap E (as Task 1 does),
  **zero questions before the survey**, recovery deferred to opt-in after. On a fresh device a re-invited
  returning user isn't recognized → boots E2, answers, then recovers earlier anchor+S in `/account`
  (this is where the E2→S re-assignment from §9.3 lives).
- **`/account` route (replaces `/secure`):** the single home for *secure your stealth account*, *recover
  an earlier anchor* (incl. E2→S re-assign), *rotate*, *manage*. Results-page CTA → `/account`. Recovery
  is never forced; user can decline and return later.

Storage progression: persist `bootstrapE` (case-2 entry) → on secure, migrate to and persist derived `S`
+ `anchor_address` flag (`anchor_address === undefined` ⇒ show CTA) → case-1 entry reuses S, case-2 entry
bootstraps then offers `/account`.

**Task 2 implementation is still NOT started.** Decision on the derived-leaf storage (user, 2026-08-30):
**keep the derived `S` private key persisted; NO removal / no encryption-at-rest.** Compromised-phone
exposure of a per-pool leaf was judged not worth the hassle — the leaf is a bounded asset (can't reach
the anchor or other pools per INV-3), and a compromised phone has bigger problems than one pool
membership. So case-1 same-device recovery stays silent (reuse `S`), no re-auth needed. Options
(email+human wallet / railgun / nihilium) remain placeholders except email+human wallet = the extracted
`humanWallet.factory.ts`. Open for the brief: the second-invite purpose (re-invite a member?) and the
railgun/nihilium definitions.

## §9.5 — Per-pool member/respondent count (2026-08-30)

**User:** wants both sources after asking "can we get respondent count per pool from contract?": (1) on-chain **registered-member count** read (panel size) AND (2) **actual respondent count** (from nilDB answer records, per RFC §7.1 — off-chain, only source that satisfies it).

**Grounded facts** (report: `brain/audits/respondent-count-per-pool-2026-08-30.md`): `poolMembers` is a private non-enumerable mapping (`S3ntimentSurveyStore.sol:115`); only `isPoolMember` predicate exists; the only on-chain counter is per-batch `cardCount` (cumulative, over-counts vs current, unaffected by revoke/rotate). No `getPoolMembers`/`getPoolMemberCount` exists.

**Decision (minimal, correct):** add `getPoolMemberCount(poolId)` read backed by a maintained `mapping(string => uint256) poolMemberCounts` counter — incremented on successful `registerInPool` (after `AlreadyPoolMember` revert so no double-count), decremented on `revokeMember` **only if the member was actually a member** (revoke is idempotent; avoid underflow), and adjusted in `rotateMember` by net delta (swap to a non-member newLeaf = net 0; Case-2 cleanup rotating to an already-member S = net −1, removing oldLeaf). Enables the panel-size proxy without enumerating the mapping. Full enumeration NOT in scope (count is what was asked). Actual respondents remain nilDB-side.

**STATUS (2026-08-30): PR #25 (`deepseek/get-pool-member-count`, commit `6c6b5b194`) IMPLEMENTED + REVIEWED — READY FOR HUMAN MERGE.** Gate independently confirmed: `@s3ntiment/contracts` **82 passing** at committed HEAD (75 baseline + 7 new). Independent review (`brain/reviews/get-pool-member-count-pr25-review-2026-08-30.md`): **all 8 acceptance items MET, 0 blocking, READY-TO-MERGE.** Non-blocking follow-ups: (1) no dedicated self-rotation test (behavior correct in code, documented, untested); (2) confirm storage-layout tail-append if the contract is an upgradeable proxy; (3) Case-2 rotate-to-already-member path verified via gate+post-asserts, pre-write guards not fully visible in the diff. Actual respondent count remains a nilDB-side (off-chain) task — the contract only exposes the registered-member panel-size proxy.

## §10 — Contract PR #24 (`rotateMember`) COMPLETE + reviewed (2026-08-30)

**PR #24** (`deepseek/rotate-member`, commit `eaf1a287f`) — implements the agreed resolution to the
registration seam: `S3ntimentSurveyStore.rotateMember(poolId, newLeaf, signature)` external,
self-authorizing membership rotation (old stealth's signature recovered + checked = acting SMC owner &
current member → atomic E→S swap in one call; chain/contract/pool-bound digest + old-leaf-removed
after swap → replay-bounded; no nonce). **Gate: 75 contract tests passing at committed HEAD (+8 new),
suite green.** Independent review (`brain/reviews/rotate-member-pr24-review-2026-08-30.md`): **all 9
contract items MET, 0 blocking, READY-TO-MERGE.** Non-blocking hardening notes only (no
already-member/self-rotation guards — cosmetically strict, not exploitable).

**This resolves the "add nothing for rotation" tension** — the contract now has the registration seam
`registerInPool` (card/nullifier-bound) could not provide. nilDB `E → S` record migration remains OUT
of contract scope (separate off-chain half of the rotate, required in the frontend PR per RFC §6).

**NEXT/IN-FLIGHT (2026-08-30): frontend `/account` PR** — results CTA gated on `anchor_address === undefined`,
`/account` route + AccountController (replaces `/secure`), humanWallet.factory key-return refactor, secure
flow (derive S → `rotateMember` → nilDB E→S migrate → wipe `bootstrapE` → persist S + `anchor_address`),
Case-2 recover/re-assign, storage helpers, tests. **PR #24 (rotateMember) IS merged** — the first-time
S-registration gap flagged in the Task 2 explore (which predated rotateMember) is resolved by rotateMember.
Queued after this: the nilDB-side actual-respondent count (RFC §7.1) and the user's remaining railgun/nihilium
option definitions.
=======
## 9.5 — Per-pool registered-member count (2026-08-30)

**Implemented.** Adds `S3ntimentSurveyStore.getPoolMemberCount(poolId)` — a current
registered-member (panel-size) count read backed by a maintained
`mapping(string => uint256) poolMemberCounts` counter (the `poolMembers` mapping is private and
**non-enumerable**, so a counter is kept — enumeration is explicitly out of scope).

**Design intent (grounded in `brain/audits/respondent-count-per-pool-2026-08-30.md`):**
- `registerInPool` increments the counter exactly once per successful registration, placed AFTER the
  `InvalidMemberAddress`/`AlreadyPoolMember` guards (at the same commit point as `batch.cardCount`),
  so a reverting registration can never double-count.
- `revokeMember` decrements ONLY if the member was actually a member (guard before the write), keeping
  the documented idempotent no-op from underflowing or double-decrementing the `uint256`.
- `rotateMember` maintains the count by net delta: swapping to a non-member `newLeaf` is net-zero
  (old out, new in); the Case-2 cleanup path (rotating to an ALREADY-member `S`) decreases it by 1
  (oldLeaf dropped, `S` stays). A self-rotation (`newLeaf == oldLeaf`) leaves the count unchanged.
- Unknown pool → `getPoolMemberCount` returns `0` (no revert), consistent with the data/aggregate
  getters (`getPoolSurveys`/`getPoolBatches` return empty) and `isPoolMember`'s default, rather than
  `getPool`'s `PoolNotFound` guard.

**SHIPPED** in PR (branch `deepseek/get-pool-member-count`): contract + tests + method-surface spec
amendment. Strictly additive (new storage + new function; no existing selector/ABI/event changed).
Actual respondent count remains nilDB-side (RFC §7.1) as before.
>>>>>>> d417e9368124ac1218d2bf81fd3f4e75ada3b2b6
