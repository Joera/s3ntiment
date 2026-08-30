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
