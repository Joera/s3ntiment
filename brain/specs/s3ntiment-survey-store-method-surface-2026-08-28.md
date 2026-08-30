# S3ntimentSurveyStore — Method-Surface Design (2026-08-28)

**Status:** DESIGN (spec). No contract changes shipped by this doc.
**Grounding:** `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` (HEAD `28fdf8c4b`)
and `brain/audits/erc1056-authority-pattern-2026-08-28.md` (the ERC-1056 authority borrow).
**Author:** s3n-orchestrator (orchestrator role).
**Framing:** borrow the ERC-1056 *authority idiom*, NOT rotation semantics and NOT the
DID-resolver surface (per handoff §7 / audit §5). Rotation = off-chain re-derivation.

---

## 1. Purpose

Give `S3ntimentSurveyStore` a deliberate, source-consistent method surface: triage every
existing method through the ERC-1056 authority lens, name the small set of *borrow*
refactors/additions, and record what must stay **absent** (on-chain rotation). The surface is
the contract's stable API contract — the frontends, the deploy script, and Lit's
`isPoolMember` access condition all read off it, so changes here are additive and guard-only.

## 2. Current method surface (verbatim from source)

**Storage / authority shape:**
- `Pool { address safe; uint256 createdAt }` — **the per-pool authority** is `pools[poolId].safe`
  (a Safe multisig). This IS an ERC-1056-style `owners[identity]` mapping (context = poolId).
- `poolMembers[poolId][address]` — per-pool respondent registry; the member address is the
  pool-wallet EOA, resolved via `ISMC(msg.sender).owner()`.
- `usedNullifiers[bytes32]` (public) — one-time card invalidation.
- `batches[poolId][batchId]`, `surveys[surveyId]`, arrays for listing. **No events emitted.**

**External (public/external) functions:**
| Function | Auth guard (from source) | Kind |
|---|---|---|
| `createSurvey(surveyId, poolId, ipfsCid, batchIds)` | inline `pools[poolId].safe != msg.sender → NotPoolSafe` (bootstrap: msg.sender becomes Safe) | write |
| `updateSurvey(surveyId, newIpfsCid)` | inline Safe check (`NotPoolSafe`) | write |
| `registerBatch(poolId, batchId)` | inline Safe check (`NotPoolSafe`) | write |
| `registerInPool(poolId, nullifier, batchId, signature)` | card ecrecover == batchId; nullifier burn; actor via `ISMC(msg.sender).owner()` | write (DR-C6-relevant) |
| `isPoolMember(poolId, member)` | none — **pure read, THE access predicate** | read |
| `isNullifierUsed(nullifier, batchId)` | none | read |
| `getSurvey / surveyExists / getPoolSurveys` | none | read |
| `getPool / poolExists / isPoolSafe / getSafePools` | none (incl. `isPoolSafe` — a view authority probe) | read |
| `getBatch / getPoolBatches` | none | read |

**Internal:** `_createPool`, `_registerBatch`, `_recoverSigner` (inline `ecrecover` over
`ethSignedHash(keccak256(nullifier|"|"|batchId))`, v∈{27,28}).

## 3. The ERC-1056 borrow, applied to THIS source

The audit's recipe maps cleanly onto code that is already live — most of the idiom is present
in slightly different clothing. Naming each mapping:

| Audit borrow (ERC-1056) | Already realized in S3ntSurveyStore | Delta to close |
|---|---|---|
| `owners[identity]` authority mapping | `pools[poolId].safe` (⇒ `principal[poolId]`) | none (exists) |
| default-to-self `identityOwner()` | not meaningful for pools (a pool MUST have a Safe); reads default to `false`/revert for unknown | N/A |
| `onlyOwner(identity, actor)` one-guard | inline `pools[poolId].safe != msg.sender → NotPoolSafe`, duplicated in 3 write fns | **centralize into `onlySafe(poolId)` modifier** (single choke-point, zero signature change) |
| recover-to-determine-actor | card `ecrecover` ⇒ batch wallet; identity via `ISMC(msg.sender).owner()` ⇒ pool-wallet EOA | exists (respondent path); no per-principal `nonce` |
| replay-proof digest `0x19‖0x00‖this‖nonce‖op‖args` | card digest namespaced by `nullifier|batchId` but **not** `this`/`nonce` | nullifier-burn already prevents card replay; `this`/`nonce` only if a Signed path ships (see §5-B) |
| per-actor nonce on signature use | absent (card one-time-ness via nullifier, not nonce) | only if §5-B |
| timestamp liveness (`validTo`) / revoke=now | **not used — nullifier-burn is the sole invalidation** ✓ | keep absent (audit §4 item 4) |
| `isValidMember` view (mirrors `validDelegate`) | `isPoolMember` ✓ | none |
| internal `(…, actor)` mutator choke-point, multi-method entry | `registerInPool` is the single registration entry | candidate §5-B (second path) |

**Net:** the design is mostly *conformation + small deltas*, not greenfield.

## 4. Design decisions

### D1 — KEEP the minimal surface; `isPoolMember` stays the SINGLE access predicate (DR-L1)
Already true in source. No second authorization path is introduced. Lit gates on
`isPoolMember(poolId, :userAddress)` only. Do not add a parallel "can this address respond"
method — one predicate, one place to get it wrong.

### D2 — NO on-chain rotation. Keep it absent.
Per anchored-identity model and handoff §7.1, the surface deliberately has **no
`changePrincipal`, `rotateMember`, `changeOwner`, `addKey`, `setAttribute`**. The source has
none today — do not add them. A member's keyed address is written once and never rewritten;
a rotated identity is a *fresh* leaf EOA that registers under its own slot (see Q2).

### D3 — BORROW: centralize the Safe authority check into one modifier (refactor, no ABI change)
Replace the three duplicated inline checks with:
```solidity
modifier onlySafe(string calldata poolId) {
  if (pools[poolId].safe == address(0)) revert PoolNotFound();   // order: existence then actor
  if (pools[poolId].safe != msg.sender) revert NotPoolSafe();
  _;
}
```
Applied to `createSurvey`, `updateSurvey`, `registerBatch`. This is the
"single choke-point so no privileged path can bypass auth" property from the audit — the
one genuinely-borrowed change, and it is **signature-preserving** (identical external
selectors/ABI). `createSurvey` keeps its bootstrap branch (`pools[poolId].safe == 0` ⇒ caller
becomes Safe) *before* the modifier, matching the current flow.

### D4 — Nullifier-burn stays the ONLY invalidation (no TTL/`validTo`)
Audit §4 item 4: prefer permanent nullifier-burn over time-bounded liveness. Cards are
one-time via `usedNullifiers`; a member address is never unregistered on-chain by design.
If a time-bound membership later becomes a real product requirement, add `validTo`
timestamp semantics then — not now.

### D5 — Keep the respondent authority resolution where it is (SMC-owner), and keep card ecrecover
`registerInPool` resolves the actor two ways today: the *card* is authorized by
`ecrecover(ethSignedHash(nullifier|batchId)) == batchId`, and the *member identity* by
`ISMC(msg.sender).owner()`. This already delivers the "recover/derive-the real actor even
though msg.sender is an abstraction layer" property that DR-C6 needs. Do not disturb it.

## 5. Candidate additions (DECISION-GATED — none ship without an explicit go)

### A. Safe-gated governance prune — `revokeMember(poolId, member)` (OPTIONAL)
If the pool Safe needs to remove a misbehaving member (a governance prune, NOT rotation),
add `revokeMember(string poolId, address member) external onlySafe(poolId)` that sets
`poolMembers[poolId][member] = false`. Guarded by the borrowed authority idiom
(D3's modifier). **Do NOT** include if "nullifier-burn as the only invalidation" is treated
as absolute — removal of a live member is a product decision, not an identity-mechanics
necessity. Decision deferred.

### B. Signed / paymaster-relayed registration — `registerInPoolSigned` (OPTIONAL, only if DR-C6 needs it)
The audit's gem is the second auth path: an off-chain principal authorizes a mutation by
ECDSA-signing a digest binding `{0x19, 0x00, address(this), nonce, context, op, args}`;
`ecrecover` ⇒ actor. The current `registerInPool` already achieves gas-abstraction via the
SMC layer, so **no Signed path is needed unless** the SMC abstraction is insufficient (e.g. a
relayer that is not a known-SMC calls the store directly, or the paymaster must not be an
on-chain contract). Only in that case add:
```solidity
mapping(address => uint) public nonce; // per-principal anti-replay
function registerInPoolSigned(string poolId, bytes32 leafNullifier, address batchId,
                              bytes calldata cardSig, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
  bytes32 digest = keccak256(abi.encodePacked(
      bytes1(0x19), bytes1(0), address(this), nonce[_principalFor(poolId)], poolId,
      "register", leafNullifier, batchId));
  // ecrecover(digest) == registered principal; nonce[recovered]++
  // then the same card-nullifier-burn + membership write as registerInPool
}
```
**Do not** build this speculatively — it adds `nonce` storage and a second entry that must
keep `isPoolMember` as the single predicate. Add only when the paymaster/relayer path is
defined. **Deferred.**

## 6. What stays ABSENT (explicit non-goals, against the audit's DROP list)
- On-chain rotation ceremony (`changeOwner`/`rotateMember`/`addKey`/`revokeDelegate` as rotation).
- Public DID-document keying / resolved DID surface; `changed[]` block-linkage event-walking.
- The `keys`/`keyType 1–4`/`Key{ purposes, keyType, revoked }` draft struct (does not exist
  in the canonical ERC-1056 anyway).
- `setAttribute`/`revokeAttribute` arbitrary public data blobs.
- Public exposure of internal principal/member maps **beyond** the read methods in §2
  (keep `poolMembers` private; `isPoolMember` is the only entry).

## 7. Open questions with method-surface impact
- **Q2 (merge / re-registration):** membership is address-keyed and immutable-per-address.
  A freshly re-derived leaf is a *new* EOA with its own `poolMembers[poolId][newAddr]` slot ⇒ it
  is not "already a member" on-chain; whether one person may hold two live memberships
  (double-count) is a **deferred-identity/off-chain (Lit) decision, not an on-chain surface
  change**. If single-membership-per-person is required, it must be enforced off-chain at the
  access layer, since the chain does not see the anchor.
- **Q5 (context granularity):** surface is keyed by `poolId` (matches INV-3 per-pool floor,
  and "standalone survey = pool with one survey"). Finer derivation granularity is a
  *derivation parameter* of the leaf KDF, not a new contract method/arg; `isPoolMember` is keyed
  by `poolId` + address and needs no change.
- **Q1 (resolved):** no ownership transfer exists ⇒ no `changePrincipal` surface needed.

## 8. Test-coverage note (CORRECTS handoff §7)
Handoff §7 said "S3ntimentSurveyStore currently has NO test coverage." That is **stale** —
`contracts/test/S3ntimentSurveyStore.test.ts` exists at HEAD `28fdf8c4b` and covers
pool/survey lifecycle, `updateSurvey`, read getters, batch management, and the full
`registerInPool` matrix (valid card, multi-member, per-pool scoping, PoolNotFound /
BatchNotFound / InvalidSignature / NullifierAlreadyUsed / AlreadyPoolMember / bare-EOA
rejection / bad-v / wrong-length). Any authority-bearing change (esp. §5-A/B) MUST ship a
matching test in this file per the handoff's own rule.

## 9. Net surface delta to carry into implementation
- **Ship (refactor, zero ABI change):** D3 — `onlySafe(poolId)` modifier centralizing the
  existing Safe check; update the doc-comments to state the authority model. This is the only
  borrow that is clearly in-scope now.
- **Deferred / decision-gated:** §5-A `revokeMember` (prune), §5-B `registerInPoolSigned`
  (paymaster) — build neither without a product/go point.
- **Never:** anything in §6.
- **Test rule:** any shipped change in this file gets a matching test in
  `S3ntimentSurveyStore.test.ts`.

### Implementation routing
This spec is orchestrator-authored design (non-code). Turning §9 into source = an `implement`
task for a `builder` sub-agent in its own worktree
(`~/code/worktrees/s3ntiment-method-surface`), opening its own PR; independent review in a
fresh session; the human merges.
