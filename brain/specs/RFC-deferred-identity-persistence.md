# RFC-001 — Deferred identity persistence

| | |
|---|---|
| **Status** | Draft — pending resolution of Q1 |
| **Date** | 2026-08-27 |
| **Author** | Recorded from working session (user proposal + review) |
| **Affects** | `s3ntiment-contracts`, `@s3ntiment/shared` (evm, nillion, browser/evm), `nillcc-backend`, `frontend-respondents` |
| **Relates to** | DR-I3 (supersedes), DR-N2 (superseded 2026-08-27), DR-N1, DR-C6, INV-1, INV-3, GAP-2 (resolved), GAP-10 (resolved) |
| **Decision** | Rotation preferred over wrapping. Mechanism for nilDB side pending Q1. |

---

## 1. Summary

Respondents are currently required to establish an on-chain identity **before** they can answer a
survey. This has been an observed blocker in test cases.

This RFC proposes **deferred identity persistence**: generate an ephemeral keypair at survey start,
register pool membership with it immediately, let the respondent answer with no login, and offer
persistence only **after** the survey is complete — at which point the membership is **rotated** to
a durable, WaaP-derived identity.

Two mechanisms for the persist step were considered — **key rotation** and **key wrapping**.
Rotation is preferred, for reasons given in §5. A hybrid fallback (§6) exists if the nilDB
reassignment dependency proves unworkable.

---

## 2. Motivation

**The observed problem.** The current flow requires WaaP login and on-chain registration before the
first question is shown. In test cases this has blocked completion. The respondent is asked to do
setup work before receiving any value, having been invited rather than having sought the tool out.

**Why this is worth solving structurally rather than with UX polish.** §4.1 of the source dossier
records the respondent audience as needing to be convinced in ~30 seconds. Under the panel framing
(dossier §6A), respondent acquisition cost is the operator's main constraint — a pool operator's
funnel is exactly the thing this blocks.

**Constraint.** Whatever we do must not weaken INV-2 (one on-chain write per respondent per pool),
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

**Both are cleared here:**

1. The ephemeral key is **random**, not derived from the nullifier. A leaked card yields a spendable
   invitation and nothing else — the same exposure as today.
2. The binding is performed **within a single session while both keys are live**. Nothing needs to
   be stored to connect them (see §7.2 for why the resulting on-chain rotation record is not a leak).

DR-I3 remains correctly rejected as stated. This supersedes it rather than contradicting it.

---

## 4. Proposal

### 4.1 Flow

1. **Card scan.** Respondent scans the QR invite. No login prompt.
2. **Ephemeral keypair `E` generated client-side**, random, and **written to device-local storage
   immediately** (not held in memory only — see §7.1).
3. **Register.** SMC deployed counterfactually, `registerInPool()` called via paymaster (DR-C6,
   unchanged). Nullifier burns. `E` is now a real pool member.
4. **Survey.** Every existing path works unchanged — `isPoolMember` passes because `E` *is* a member.
   No new access predicate, no second authorization path (§8.1).
5. **Persist offer**, after completion: *"keep access to your answers and see the results"*.
6. **On accept:** WaaP login → durable key `D` derived → nilDB records reassigned from `E` to `D`
   → `rotateMember(poolId, D, sigFromE)` on-chain → `E` discarded.

### 4.2 Ordering, and why this order

**nilDB first, chain second, discard last.** This is load-bearing:

- Fail during reassignment → chain untouched, nothing has happened, fully retryable on next visit.
- Fail during rotation → records under `D`, membership still `E`. Recoverable because `E` is still
  held.
- **Never discard `E` on a timer** — only after rotation confirms.

The persist step must be **resumable**: a half-finished persist is completed on the next visit, not
left inconsistent or restarted from scratch.

### 4.3 Contract change

New function, shape approximately:

```
rotateMember(string poolId, address newMember, bytes sigFromOld)
```

**Make it general, not persist-specific.** The same function should serve device loss, key
compromise, and a later device-key→WaaP upgrade. This costs nothing extra now and avoids a second
contract change later. Redeployment is acceptable (**[user]**: "redeploying contract is not a
blocker if the outcome is better").

⚠ `S3ntimentSurveyStore` currently has **no test coverage** in the source share (SPEC-contracts).
A new authority-bearing function should not ship without one.

---

## 5. Alternatives considered

### 5.1 Key rotation (preferred)

`E` registers and is the member; at persist, membership moves `E`→`D` on-chain. The pool key after
persist is derived from WaaP.

**Pros**
- **Revocation exists** as a general primitive — compromised key, lost device, untrusted browser.
- **No secret at rest.** After persist the pool key is derived deterministically from a WaaP
  signature. Nothing stored anywhere.
- **Recovery requires nothing external** — WaaP anywhere → derive → member. No blob to fetch, no
  dependency on nilDB availability for access.
- **Literal fit with promise 2** — "an account mathematically derived from your email address."
- **No bulk-theft target** — no collection of encrypted private keys exists.
- Contract can enforce one-membership-per-durable-address, which matters for panel counting
  integrity (dossier §6A).
- Composes with later needs: recovery signers, device migration, delayed upgrade.

**Cons**
- New contract function; contract currently untested.
- Second transaction per respondent lifecycle — gas, and a second failure point.
- **Non-atomic persist** — chain tx plus nilDB reassignment. Mitigated by §4.2 ordering.
- Rotation events are publicly countable (cardinality only, no identity).
- Merge case needs a decision (§8.2).
- **Depends on nilDB record reassignment being achievable** (§6, Q1).

### 5.2 Key wrapping (rejected)

`E` registers and remains the member permanently; at persist, a WaaP-derived key encrypts `E`'s
private key and the ciphertext is stored in nilDB under the WaaP DID. WaaP only unlocks `E`.

**Pros**
- Zero contract change.
- **Atomic and idempotent persist** — one nilDB write; fails cleanly, retries safely.
- No extra gas.
- The `E`↔`D` relationship never appears publicly.
- Simplest failure mode: not persisted yet, try again.

**Cons**
- **No revocation, ever.** `E` is the membership for life; compromise is permanent and the member
  cannot be evicted without abandoning the membership.
- **Stores private key material at rest.** Encrypted, but durable. Lose the blob or lose nilDB
  reachability → locked out despite valid WaaP credentials.
- A wrapped-key collection is a **standing honeypot**, even with per-entry encryption.
- **A malicious or compromised frontend can exfiltrate `E` once and retain access indefinitely.**
  Under rotation there is no long-lived secret to lift.
- Weaker on the walk-away test — recovery depends on Nillion being reachable.
- Two keys forever, two storage paths to keep correct.

### 5.3 Why rotation wins

Two arguments, pointing the same way:

1. **The key is born on a device we don't control.** The physical-card use case is explicitly *hand
   cards out at a venue* — some keypairs will be generated on a shared laptop, kiosk, or borrowed
   phone. Wrapping makes that browser-generated key the person's permanent pool identity. Rotation
   treats it as what it is: a bootstrap credential, replaced as a normal part of the flow.
   **Given where these keys are born, revocation is closer to a requirement than a feature.**
2. **Wrapping introduces a stored secret; rotation removes one.** Everything else in this
   architecture derives keys rather than storing them. A collection of encrypted private keys is a
   category of asset that does not currently exist in the system, and it brings loss-means-lockout
   and compromise-means-permanent with it.

Wrapping's genuine advantage — idempotent single-write persist — is a one-time correctness problem,
addressed by §4.2 ordering.

### 5.4 Card-proof access (raised and withdrawn)

Briefly proposed during review: gate the respondent decrypt action on *"valid signature from a
registered batch of this pool, and nullifier unspent"* instead of `isPoolMember`, deferring the
nullifier burn to the persist step so abandonment costs nothing.

**Withdrawn.** It adds a second parallel authorization path — more security code in the action
(which under DR-L1 is the actual security boundary) for a **weaker** predicate, since a photographed
card circulates freely until burned. It also degrades survey-content confidentiality from
"registered members" to "anyone holding an unspent card." `isPoolMember` stays the single access
predicate.

Recorded because it will otherwise be re-proposed: the appeal is that abandonment doesn't spend a
card (§7.1), and that appeal is real. The cost is not worth it.

---

## 6. The nilDB reassignment dependency

**[user, correctly]**: rotation "does still depend on reassign nilDB records being achievable."

This is the RFC's main open risk, and it behaves differently in the two data models:

### 6.1 Under DR-N2 (current — standard collections)

**Nearly free.** The builder owns the collection and writes every record; `submitResponseForUser`
already performs delete-then-recreate filtered on `signer`. Reassignment is that same operation with
a different `signer` value. No new capability, no user-side crypto, no new trust assumption — the
backend already holds exactly this authority. Authorization is a signature from `E` over a challenge
naming `D`, or simply reading the chain post-rotation as source of truth.

### 6.2 Under owned collections (now the live path — DR-N2 superseded)

**Harder, and unverified.** Records carry `owner: DID_E`. Moving them requires either a native
ownership transfer, or delete-under-`E` plus recreate-under-`D` — client-side, two operations,
non-atomic, both keys live simultaneously.

> ⚠ **Q1 (blocking):** does `@nillion/secretvaults` expose an ownership transfer for owned records?
> If it is delete+recreate only, the persist step becomes a client-side multi-step operation. This
> is now the *live* path: the owned-collections merge (2026-08-27) made `storeOwned` the live write
> path (INV-1) with the per-pool PKP as collection owner (DR-N3), so the Q1 answer gates this RFC's
> persist step directly.

### 6.3 The coupling worth naming

**Persist-by-rotation is harder on the live owned path.** DR-N2 was reversed by the owned-collections
merge (2026-08-27): owned collections are the design, GAP-10 is resolved, and `storeOwned` is the live
write path. The harder persist-by-rotation path this section describes is therefore the *current*
path, not a future one — the two work items are coupled now, not prospectively.

---

## 7. Costs and consequences

### 7.1 Abandonment spends a card

The nullifier burns at step 3, so an abandoned session consumes an invitation.

**Mitigation:** writing `E` to device-local storage at generation (§4.1) means a membership is
orphaned only if storage is cleared or the device changes before persisting — not merely by closing
the tab.

**Not fully mitigable:** orphans are permanent. Nobody holds the key, so they cannot be reclaimed or
rotated.

**Reporting consequence:** under the panel framing (dossier §6A), report **active respondents**, not
registered members — otherwise response-rate figures are quietly wrong. This matters commercially,
since panel quality claims are the product.

### 7.2 The on-chain rotation record is not a meaningful leak

Initially raised as an objection, then withdrawn on challenge (**[user]**: *"1st survey is submitted
from a random, temp keypair — what would that reveal?"*). Recorded with the reasoning so it isn't
re-litigated:

`E` is random, has no funding history, no prior transactions, and exists only from survey-start
onward. Learning `D ↔ E` reveals that the person behind `D` also controlled `E` — which is already
known, since they are the same person in the same session. No external identity is attached to `E`.

Residuals checked and dismissed: registration **timing** is public either way; **IP correlation at
registration** is identical under both models since registration is on-device in both; **cross-pool**
linkage is unaffected because INV-3 gives a fresh key per pool; **nilDB records** are governed by
ACL regardless.

The only surviving residual is a weak set-partition argument — rotation publicly splits the pool
into "rotated" and "not," with observable timing. Persist-vs-not is inferable under wrapping too.
Not a material difference.

### 7.3 Second transaction

Gas cost per respondent lifecycle roughly doubles, and a second failure point is introduced. Paid by
the paymaster (DR-C6), so invisible to the respondent, but it is a real operating cost for the pool
operator at panel scale.

### 7.4 The funnel step moves rather than disappearing

Asking *"want to keep this?"* after someone has answered converts better than *"create a wallet to
begin"* before they have done anything — and the results can be offered as the reward. But
persistence is still a step, and drop-off should be expected to **move and shrink**, not vanish.

---

## 8. Design decisions taken

### 8.1 `isPoolMember` remains the single access predicate

No second authorization path (§5.4). Under DR-L1 the in-action check *is* the security boundary;
adding a parallel predicate multiplies the surface where a missing guard clause silently decrypts.

### 8.2 Persistence tiers — recommended, not decided

Consider offering two:
- **Device-local durable key** — zero friction, this browser only.
- **WaaP** — cross-device, matches promise 2.

This separates *persist* from *log in*, which is the part that actually hurts. Most respondents will
take the first; some upgrade later — which the general `rotateMember` (§4.3) already supports.

### 8.3 GAP-2 interaction

`getUserWriteDelegation` currently issues write delegations with no membership check (GAP-2). Under
this RFC the ephemeral identity **is** a member at write time, so the correct fix — check
`isPoolMember` — remains available and is not complicated by deferred persistence. (This was a real
advantage of the withdrawn §5.4 variant and is *lost* along with it; note it if §5.4 is ever
revisited.)

---

## 9. Open questions

- **Q1 (blocking)** — Does `@nillion/secretvaults` support ownership transfer for owned records, or
  only delete+recreate? Decides between "rotation with reassignment" and the §10 hybrid. (§6.2)
- **Q2** — Merge case: what happens when `newMember` is already a member of that pool? Revert, or
  merge? If merge, nilDB records must be reconciled too.
- **Q3** — Was the observed test-case blocker the **wallet setup** or the **transaction latency**?
  If setup, this RFC removes it. If Base confirmation latency, this converts a wall into a spinner
  and a different fix applies (pre-warm SMC deployment, or begin registration on card scan while the
  intro screen renders). **This should be answered before implementation**, since it determines
  whether the RFC solves the actual problem.
- **Q4** — TTL and measurement for orphaned unpersisted memberships (§7.1).

---

## 10. Fallback: split the identities (if Q1 resolves badly)

If nilDB reassignment proves unreliable, the chain key and the nilDB seed need not be the same
thing:

- **Rotate the chain key** — membership, survey decryption, revocation. No stored secret.
- **Hold the nilDB identity stable at `DID_E`**, and wrap **only the nilDB seed** under the
  WaaP-derived key.

This splits the problem by what each key can do. Compromise of the chain key means impersonation as
a pool member — must be revocable, hence rotation. Compromise of the nilDB seed means read/edit
access to one's own answers — bad but bounded, and **no reassignment is ever needed** because the
data identity never moves.

Cost: two mechanisms instead of one. Benefit: removes the §6 dependency entirely, and confines the
stored secret to where continuity matters rather than where authority lives.

---

## 11. Change list (if accepted)

- **contracts** — add general `rotateMember`; decide Q2; add test coverage for
  `S3ntimentSurveyStore` (currently absent).
- **shared/browser/evm** — ephemeral keypair generation + device-local persistence; counterfactual
  SMC deploy at card scan.
- **shared/nillion** — record reassignment routine (or, under §10, seed wrap/unwrap).
- **nillcc-backend** — reassignment endpoint authorized by `sigFromE` over a challenge naming `D`;
  resumable/idempotent persist; orphan measurement.
- **frontend-respondents** — remove login gate from entry; add post-survey persist offer with
  results as the incentive; resume flow for half-finished persists.
- **specs** — record as **DR-I4** in SPEC-shared, noting it supersedes DR-I3; update INV-3 note;
  cross-reference GAP-2 and GAP-10 (both resolved by the owned-collections merge — the delegation
  is now membership-checked in the `user-delegation` action, and the PKP owns collections).