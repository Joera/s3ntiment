# RFC-001 — Deferred identity persistence (anchored identity model)

| | |
|---|---|
| **Status** | Draft — v2, rebuilt on the anchored-identity model (2026-08-28) |
| **Date** | 2026-08-27 → **rev. 2026-08-28** |
| **Author** | Recorded from working session (user proposal + review) |
| **Affects** | `s3ntiment-contracts`, `@s3ntiment/shared` (evm, nillion, browser/evm), `nillcc-backend`, `frontend-respondents` |
| **Relates to** | DR-I3 (supersedes), DR-N2 (superseded 2026-08-27), DR-N1, DR-C6, INV-1, INV-3, GAP-2 (resolved), GAP-10 (resolved) |
| **Decision** | Identity = **anchor → derived stealth leaf(ren)**. Registration + access ride on the unlinkable leaf. Rotation = re-derivation. Recovery = re-derivation from the anchor. Nillion enforcement unchanged. |

---

## 1. Summary

Respondents are currently required to establish an on-chain identity **before** they can answer a
survey — an observed blocker in test cases, and backwards for a walk-up panel audience.

This RFC solves deferred persistence with a specific identity model (the **anchored-identity
model**), which resolves both the funnel blocker *and* the durability/recovery requirement at once:

- A **durable anchor identity** (a seed phrase / hardware key / external on-chain address) is held
  **independently of the app** and its local storage. It is the user's *recovery and portability*
  mechanism — the whole point of the anchor is that it is **app-independent**.
- The anchor **deterministically derives one or more stealth identities** (unlinkable, anonymous,
  per-context). These leaves are what act on-chain and own data — never the anchor itself.
- A **stealth leaf is registered on-chain** to gate survey access. This is safe *because it is
  unlinkable*: nothing on-chain points back to the anchor.
- **Rotation = re-derivation** (derive a fresh leaf, migrate its records). **Recovery = re-derivation
  from the anchor.** No key-event ceremonies, no stored recovery shares — derivation from the
  app-independent anchor *is* the answer.

The older framing (random ephemeral key `E`, rotated at persist time to a WaaP-derived key `D`)
is **subsumed**: `E` is now exactly the *bootstrap stealth leaf* for an anchor-less first visit, and
the persist step is "establish an anchor, then re-derive." This is a v2 rewrite; §6 records what the
v1 rotation framing turned into and why the general rotation ceremony from prior-art research was
rejected (§5.3).

---

## 2. Motivation

**The observed problem.** The current flow requires WaaP login and on-chain registration before the
first question is shown. In test cases this has blocked completion. The respondent is asked to do
setup work before receiving any value, having been invited rather than having sought the tool out.

**Why this is worth solving structurally rather than with UX polish.** §4.1 of the source dossier
records the respondent audience as needing to be convinced in ~30 seconds. Under the panel framing
(dossier §6A), respondent acquisition cost is the operator's main constraint — a pool operator's
funnel is exactly the thing this blocks.

**The second, deeper motivation.** Identity should not die with local storage. An app-local key is
opaque to the next device, the next browser, the lost phone. The anchored-identity model makes the
user's durable identity **independent of the app**: the anchor is held outside it, and the app only
ever holds *derived* leaves it can re-derive at any time. This is the capability worth building on
its own terms — it is, in the general sense, the "storage-independent identity" that any dapp with
self-custody keys eventually needs (see §5.3).

**Constraints.** Whatever we do must not weaken INV-2 (one on-chain write per respondent per pool),
INV-3 (identity resolves through a per-pool key, no master identity), or promise 2 (access via email
without the email being stored).

---

## 3. Relationship to DR-I3 — this is not a re-proposal

DR-I3 ("deferred WaaP login, card-derived signer first") was explored in Mar 2026 and rejected. The
specs carry an explicit instruction to re-read it before re-proposing. It is therefore necessary to
state precisely why this RFC is not the same proposal.

DR-I3's two blocking objections were:

1. **Nullifier reuse as key seed.** Deriving the first-visit key from the card nullifier means a
   photographed or leaked card yields the respondent's signing key, not merely a spent invitation.
2. **The linkage problem.** Binding visit-1 identity to visit-2 identity requires storing a
   card→WaaP binding; on-chain it leaks the link, in nilDB it sits behind the access control the key
   was meant to unlock.

**Both are cleared here, and the anchored model clears them more cleanly than v1:**

1. The ephemeral key is **random** (bootstrap leaf), or — when the respondent has an anchor — the
   leaf is **derived from the anchor**, never from the card. A leaked card yields a spendable
   invitation and nothing else; a leaked card cannot derive any leaf because the anchor is not the
   card.
2. The binding is performed **within a single session while both keys are live**, or — with an
   anchor — need not store a binding at all because the leaf is a *derivation*, so re-deriving is
   sufficient (nothing to store to reconnect). The on-chain rotation/registration record is not a
   leak (§7.2).

DR-I3 remains correctly rejected as stated. This supersedes it rather than contradicting it.

---

## 4. The anchored-identity model (centerpiece)

The identity model this RFC is built on. Two layers, deliberately distinct.

### 4.1 Vocabulary — don't call the leaf "private"

The word "private" has muddled this design twice. Use:

- **Anchor identity** (the durable layer) — a seed phrase, hardware key, or external on-chain
  address the user holds **independently of the app**. It never lives only in app-local storage,
  and it **never appears on-chain of its own accord**. Its whole purpose is *independence from the
  app*: recovery and portability.
- **Stealth identity** (the leaf layer) — **deterministically derived** from the anchor, **one per
  context**, and **unlinkable**. "Stealth" not "private": on-chain presence is expected and safe,
  because a stealth key cannot be reversed to the anchor and different contexts get different keys
  that do not correlate to each other. This is Monero-style stealth, not mere privacy.

Not "sovereign," not "private": **anchor** (durable, app-independent, stays off-chain) and **stealth**
(derived, unlinkable, acts on-chain).

### 4.2 Anchor = durable, app-independent

- Durable, portable, recoverable across device/browser loss.
- The **recovery and rotation backstop**: everything derived comes back by re-derivation.
- Held outside the app (seed/hardware/personal custody). The app never holds the crown jewel.
- **Single point of failure by construction** — compromise of the anchor derives every leaf. This is
  the inherent cost, and the reason the anchor must stay app-independent; it is also why only leaves
  ever reach the app's local storage.

### 4.3 Stealth = derived, unlinkable, per-context

- `leaf_i = KDF(anchor, context_i, purpose="stealth")` — deterministic, one-way, salted per context.
- Each context (per pool / per survey / per install) gets its own leaf, so on-chain presence does not
  correlate contexts to each other or to the anchor.
- The leaf is what **owns Nillion records** (`owner = did:key` from the leaf) and what is registered
  on-chain to gate access.
- Derivation is one-way: a leaf-holder cannot recover the anchor; an anchor-holder can re-derive all
  leaves.

### 4.4 Why on-chain registration is safe

Because the thing registered is the **stealth leaf**, not the anchor, and it is unlinkable. The old
objection — "interaction of the public identity with a contract loses privacy" — is answered by
separation: the **anchor never touches the contract**; the leaf does, and nothing on-chain points
back to the holder. Registration of an anonymous, per-context, freshly-derived key carries no
identity signal (§7.2).

### 4.5 Rotation = re-derivation

Rotating a leaf = derive a fresh leaf (bumped context/nonce), register it, and move the records
(§6). No chain-of-custody ceremony, no signed hand-off event: **the derivation is itself the proof**
of legitimacy, because only the anchor (or the user controlling it) can produce the same leaf.

### 4.6 Recovery = re-derivation from the anchor

Lose the app, the device, or the leaf → re-derive from the anchor. The anchor **is** the recovery
mechanism, so no external recovery shares, no social-recovery guardians, no threshold ceremony are
needed for the private layer.

---

## 5. The persist flow (deferred, and how the model resolves it)

Two respondent populations, handled uniformly by the same model:

### 5.1 Respondent with an existing anchor ("existing" public identity)

1. **Card scan.** No login prompt.
2. **Derive** a stealth leaf from the anchor (`context = poolId`), client-side.
3. **Register.** SMC deployed counterfactually, `registerInPool()` via paymaster (DR-C6). Nullifier
   burns. The leaf is a real pool member.
4. **Survey.** Every existing path works unchanged — `isPoolMember` passes because the leaf *is* a
   member.
5. No persist step is forced: the identity was durable from the start (re-derivation recovers it).
   Optionally offer cross-context "upgrade" later.

### 5.2 Respondent with no anchor (walk-up card, "new" public identity)

1. **Card scan.** No login prompt.
2. **Bootstrap leaf `E`** — random, **written to device-local storage immediately** (not held in
   memory only — §7.1). Treated as a bootstrap credential, not a permanent identity.
3. **Register.** As above; `E` becomes a member; survey works.
4. **Persist offer** after completion: *"keep access to your answers and see the results."*
5. **On accept:** establish an anchor (create a seed/hardware identity, or import an existing one) →
   **derive the durable stealth leaf `S` from it** → register `S` → move records `E→S` on nilDB →
   `E` discarded.
6. **On decline / abandon:** `E` may be re-derived never (it was random), but the *anchor* route is
   always available if the user comes back with credentials. The deferral converts the funnel blocker
   into a post-value offer.

### 5.3 What we deliberately dropped: the general rotation ceremony

Prior-art research (archived `brain/audits/rotation-primitive-prior-art-2026-08-28.md`) surfaced the
mature general answer to "how does an identifier's key rotate in place": **KERI** — a self-verifying
identifier whose key rotates through an append-only, signed key-event log with pre-rotation and
witnesses. For a *general*, hot-key-hand-off problem this is real prior art. **It is needlessly
complex for this design** and is **not adopted** here:

- **Derivation removes the ceremony.** Rotation and recovery both reduce to *re-derivation from the
  anchor*. There is never a "hot key handing off to a successor while still held" that needs a
  signed, witnessed event — the anchor↔leaf derivation *is* the proof.
- **KERI's machinery** (indirect mode: witnesses, KERL receipts, duplicity gossip, pre-rotation
  commitment, key pre-rotation with double-hash) and **recovery shares** (SSS/SLIP-0039 t-of-n)
  solve problems (app-independent durable root, loss-recovery) that the **anchor already is**. Adding
  them duplicates the anchor's job at ceremony cost.
- **ERC-1056/did:ethr rotation methods** are good *patterns* (addKey/revokeKey/changeOwner,
  key-types, revoke-before-activate ordering) but were verified **not** to apply to Nillion — NUC
  resolves `did:ethr` as address-as-signer, never the registry — and their ceremony is unnecessary
  when re-derivation suffices.
- The **one general lesson kept**: separate the *stable identity* (the anchor) from the *operational
  keys* (leaves). That separation — the actual "must-have for any dapp" — is this model's whole
  point, and it is achieved with one KDF, not a ceremony.

**Sell:** the anchored model is the part worth keeping from the research. It gives recovery,
portability, unlinkability, rotation, and access-gating from a **single deterministic derivation**
instead of a signed-event infrastructure. Everything else from the general rotation survey is either
subsumed by the anchor or is ceremony the derivation makes redundant.

---

## 6. The nilDB / ownership constraint (same in both models)

**`_owner` is immutable.** An owned record's owner is a `did:key` derived from the leaf, set at
create, and never changes. So **any change of leaf ⇒ records migrate**. Verified 2026-08-28 against
`@nillion/secretvaults@3.0.0` / `NillionNetwork/nildb` (audits:
`ownership-rotation-research`, `acl-grant-existing-owned-docs`).

Two migration mechanics, chosen by intent:

- **ACL-grant** (light, in place): `POST /v1/users/data/acl/grant|revoke` does `$push`/`$pull` on
  `_acl`, document-scoped, owner-only, grantee must be a registered builder. Use when the *purpose*
  is the new leaf gaining read/write/execute on the same records — keeps `_owner`, `_id`, history.
- **Delete+recreate** (ownership move): delete under the old leaf, recreate under the new — the
  already-existing `updateOwned` pattern. Use when the new leaf must actually **own** the data.

> **Q1 (formerly blocking) — resolved (2026-08-28):** `@nillion/secretvaults` exposes **no ownership
> transfer**; it is ACL-grant or delete+recreate only. The owned-collections merge made `storeOwned`
> the live write path with the per-pool PKP as collection owner, so migration-on-rotation is the
> *current* path, not a future one. The re-derivation model pays this cost on every rotation, and it
> is the accepted constraint.

---

## 7. Costs and consequences

### 7.1 Abandonment spends a card (anchor-less population only)

The nullifier burns at registration, so an abandoned session consumes an invitation. Writing the
bootstrap `E` to device-local storage at generation means a membership is orphaned only if storage is
cleared or the device changes before persisting — not by closing the tab. **Mitigation:** respondents
with an existing anchor never see this — their leaf is recoverable, so "abandon" is moot.

**Reporting consequence:** under the panel framing, report **active respondents**, not registered
members — otherwise response-rate figures are quietly wrong.

### 7.2 The on-chain registration/rotation record is not a meaningful leak

It was raised as an objection and withdrawn on challenge. Recorded so it isn't re-litigated:
registered/derived leaves are random, fresh, per-context, with no funding history, no prior
transactions, and no external identity attached. A leaf↔leaf or leaf↔anchor relation reveals only
"the same anonymous actor controlled both," which is either known (same session) or unlinkable
(your call, so it must be your choice to link).

Residuals checked and dismissed: registration **timing** is public either way; **IP correlation at
registration** is identical under both models (on-device in both); **cross-pool** linkage is absent
because INV-3 gives a fresh leaf per pool; **nilDB records** are ACL-governed regardless. The only
surviving residual is a weak set-partition argument (publicly, a pool splits into "has-anchor" and
"not") — not a material difference.

### 7.3 Second transaction (anchor-less persist only)

Registering the derived leaf at persist adds a second transaction in the anchor-less case. Paid by
the paymaster (DR-C6), invisible to the respondent, but a real operating cost at panel scale.
Respondents who arrive with an anchor need only the one.

### 7.4 The funnel step moves rather than disappearing

Asking *"want to keep this?"* after someone has answered converts better than *"create a wallet to
begin."* For the anchor-less population persistence is still a step; drop-off moves and shrinks, but
does not vanish. For the with-anchor population there is no step at all.

---

## 8. Design decisions taken

### 8.1 `isPoolMember` remains the single access predicate

No second authorization path. Under DR-L1 the in-action check *is* the security boundary; a parallel
predicate multiplies the surface where a missing guard silently decrypts. The leaf *is* a member at
all times, so `isPoolMember` needs no second predicate for the deferred case.

### 8.2 Anchor is app-independent by definition

The anchor never lives only in app-local storage — seed/hardware/personal custody. This is not a UX
choice; it is what makes recovery and the "app can't hold the crown jewel" property hold. The app's
local storage holds only derived leaves (and the transient bootstrap `E`).

### 8.3 GAP-2 interaction

`getUserWriteDelegation` currently issues write delegations with no membership check (GAP-2). Under
this RFC the acting identity (bootstrap `E` or derived leaf) **is** a member at write time, so the
correct fix — check `isPoolMember` — remains available and is not complicated by deferred identity.

---

## 9. Open questions

- **Q1 (resolved)** — ownership transfer for owned records? **No — delete+recreate or ACL-grant only**
  (verified 2026-08-28). Migration-on-rotation is the accepted constraint. *Resolved from
  "blocking" to "accepted."*
- **Q2** — Merge case: what happens when a newly-registered leaf is already a member of that pool
  (re-registration of a re-derived leaf)? Revert, or treat as idempotent re-entry? If merge, records
  must not duplicate.
- **Q3** — Was the observed test-case blocker the **wallet setup** or the **transaction latency**?
  If setup, the model removes it. If Base confirmation latency, this converts a wall into a spinner
  and a different fix applies (pre-warm SMC deployment, or begin registration on card scan while the
  intro screen renders). **Answer before implementation.**
- **Q4** — TTL and measurement for orphaned anchor-less memberships (§7.1).
- **Q5** — Derivation `context` granularity: per pool, per survey, per install? Per-pool (INV-3) is
  the floor; decide whether finer granularity is worth the extra on-chain registrations.
- **Q6** — Anchor creation UX for the anchor-less population: what form (phrase, hardware, delegated
  address)? This is the persist-step's actual friction and deserves a concrete design before
  implementation.

---

## 10. Fallback: split chain identity from data identity (if derivation is insufficient)

The anchored model uses the anchor to derive both the on-chain acting leaf *and* the nilDB owner. If
a future constraint forces a split:

- **Rotate/derive the chain leaf** — membership, survey decryption, revocation. Revocable because
  re-derivable.
- **Hold the nilDB identity at a stable leaf** and re-derive only when access must change.

This is a *contingency*, not the plan. The plan is one derivation serving both roles, since nilDB
`_owner` immutability is the same either way and ACL-grant already covers access-only changes without
an ownership move.

---

## 11. Change list (if accepted)

- **shared/browser/evm** — anchor-representation handling (phrase/hardware/delegated import);
  deterministic leaf derivation (`KDF(anchor, context)`); bootstrap-`E` generation + device-local
  persistence for the anchor-less population; counterfactual SMC deploy at card scan.
- **shared/nillion** — record migration helper for leaf→leaf (ACL-grant for access, delete+recreate
  for ownership — both already exercised by `updateOwned` / the ACL endpoints).
- **contracts** — `registerInPool` remains the single registration; add nothing for rotation
  (re-derivation needs no contract ceremony). Revisit only if Q2 demands idempotent re-registration
  semantics. Add test coverage for `S3ntimentSurveyStore` if any contract change ships (currently
  absent — see SPEC-contracts).
- **nillcc-backend** — registration/access endpoints keyed to the acting leaf; no reassignment
  endpoint needed in the derived-leaf model (re-derivation replaces reassignment); orphan
  measurement.
- **frontend-respondents** — remove login gate from entry; add post-survey persist offer (results as
  the incentive) for the anchor-less path; resume flow for half-finished persists.
- **specs** — record as **DR-I4** in SPEC-shared, noting it supersedes DR-I3 and the v1 E→D rotation
  framing (subsumed as bootstrap→re-derivation); update INV-3 note; cross-reference GAP-2 and GAP-10
  (resolved by the owned-collections merge).

---

## 12. Audit trail

This RFC consolidates four verified research threads (all archived in `brain/audits/`):

- `ownership-rotation-research-2026-08-28.md` — did:key owner immutability confirmed from source;
  no native ownership transfer; delete+recreate = `updateOwned`.
- `acl-grant-existing-owned-docs-2026-08-28.md` — `_acl` mutable in place via
  `POST /v1/users/data/acl/grant|revoke` ($push/$pull), owner-scoped, grantee must be a registered
  builder.
- `didethr-rotation-2026-08-28.md` — NUC did:ethr is address-as-signer (no ERC-1056 resolution); no
  rotation benefit over did:key. Not adopted.
- `rotation-primitive-prior-art-2026-08-28.md` — KERI/did/DID-method/recovery prior art; recommended
  "direct-mode key-event log." **Deliberately reduced** to anchor→stealth derivation in §4/§5.3 after
  review concluded the general ceremony is needlessly complex here.
