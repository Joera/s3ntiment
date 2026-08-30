# AUDIT — Respondent count per pool: can we get it from the contract?

**Date:** 2026-08-30
**Scope:** read-only exploration of `S3ntimentSurveyStore.sol` + ABI + backend read helpers.
**Question:** is there an on-chain way to know how many respondents a pool has (directly or derivably)?

---

## (a) Direct answer

**No — there is no direct on-chain getter for a per-pool respondent count.** The pool registry
exposes `getPool`, `poolExists`, `isPoolSafe`, `getSafePools`, `getPoolSurveys`,
`getPoolSurveysSince`, `getPoolBatches` and per-batch `getBatch` — but **no `getPoolMembers`,
`getPoolMemberCount`, or any pool-level membership/respondent counter** exists.

There is exactly **one** on-chain counter related to membership: the **per-batch `cardCount`**
(`Batch.cardCount`, `uint256`, `S3ntimentSurveyStore.sol:88`), incremented once per successful
`registerInPool` call (`S3ntimentSurveyStore.sol:468`). It is monotonic and scoped to a single batch
wallet, exposed read-only via `getBatch(poolId, batchId)` (`S3ntimentSurveyStore.sol:400-407`), with
the set of a pool's batch addresses exposed via `getPoolBatches(poolId)` (`S3ntimentSurveyStore.sol:410-411`).

**Derivable, but only as a *registered-members (cards-redeemed)* cumulative metric:**
```
memberRegistrations(pool) ≈ Σ over b in getPoolBatches(pool) of getBatch(pool, b).cardCount
```
Because every successful card redemption increments `cardCount` atomically with the membership write
(`batch.cardCount++; ... poolMembers[poolId][poolWallet] = true;`, `S3ntimentSurveyStore.sol:468-477`),
the sum across batches equals the number of **distinct leafs that have ever registered via card** in
that pool (nullifier burn + `AlreadyPoolMember`/`InvalidMemberAddress` reverts roll back the increment,
so `cardCount` counts only successful, distinct registrations).

**Caveats on that derived number** (see §(b)):
- It is **cumulative**, not current: `revokeMember` sets `poolMembers[poolId][member] = false`
  (`S3ntimentSurveyStore.sol:495`) without decrementing any `cardCount`, and `rotateMember` swaps
  `oldLeaf`→`newLeaf` (`S3ntimentSurveyStore.sol:567-568`) without touching `cardCount`. So the sum
  **over-counts** currently-active members after any revocation, and counts leaves rather than people.
- It is a **registered-member** proxy, and registered members ≠ **respondents** (people who actually
  answered a survey). Response/participation happens entirely **off-chain in nilDB** (see §(b)).

**There is no pool-level member counter at all**, so even the derived number has to be assembled
client-side by enumerating `getPoolBatches` → summing `getBatch(...).cardCount`. That is the only
on-chain-derivable "how many joined this pool." It cannot tell you who, current membership, or who
answered.

---

## (b) The registered-members vs actual-respondents caveat (the RFC/handoff distinction)

The RFC is explicit that a contract-side count is **not** a respondent count:

> **RFC §7.1** (`brain/specs/RFC-deferred-identity-persistence.md:246-247`): "**Reporting
> consequence:** under the panel framing, report **active respondents**, not registered members —
> otherwise response-rate figures are quietly wrong."

The distinction is structural, not just policy:

1. **Membership is established on-chain; participation is off-chain.** The contract doc-comment states
   plainly: "Survey participation is off-chain (nilDB); no per-survey on-chain interaction"
   (`S3ntimentSurveyStore.sol`, header note ~line 17) and "Survey participation is invisible on-chain"
   (~line 33). The chain only records "this address is a member of this pool."
2. **The contract's membership set is `poolMembers`, and it is a private, non-enumerable mapping**:
   `mapping(string => mapping(address => bool)) private poolMembers;` (`S3ntimentSurveyStore.sol:115`).
   It is **not** an array/list. There is **no `poolMembersList`, no index, no member-count field**, and
   **no `getPoolMembers` / enumerate function** anywhere (confirmed by grep across `contracts/src` and
   `contracts/generated` — zero hits; and the full ABI lists no such read in
   `contracts/generated/abis/S3ntimentSurveyStore.ts`).
3. **It is only membership-checkable**, via the single predicate `isPoolMember(poolId, addr) ->
   bool` (`S3ntimentSurveyStore.sol:577-579`). You can ask "is this exact address a member?" but you
   **cannot enumerate members** or count them on-chain. (This matches RFC §8.1: `isPoolMember` is the
   single access predicate used by Lit; it is not an enumeration primitive.)

Consequences:
- A "respondent count" for response-rate purposes can **only** come from **nilDB answer records**
  (off-chain), as §7.1 implies — never from the contract, because survey responses never touch the chain.
- The derivable `Σ cardCount` figure is, at best, a **registered-member / panel-size** proxy (cumulative
  cards redeemed), and even that is a ceiling that ignores revocations and collapses rotations.

---

## (c) Do rotateMember / revokeMember / registerBatch change counting or enumeration capability?

**No — none of them add any enumerability or a member counter.** They are all point mutations of the
same non-iterable `poolMembers` mapping:

- **`revokeMember(poolId, member)`** (`S3ntimentSurveyStore.sol:493-495`): Safe-gated,
  `poolMembers[poolId][member] = false`. No count decrement; no removal from any list (there is none).
- **`rotateMember(poolId, newLeaf, signature)`** (`S3ntimentSurveyStore.sol:535-568`): self-authorizing
  swap, `poolMembers[poolId][oldLeaf] = false; poolMembers[poolId][newLeaf] = true;` (567-568),
  emits `Rotated(poolId, oldLeaf, newLeaf)`. **Membership count is unchanged**; `cardCount` is untouched.
- **`registerBatch(poolId, batchId)`** (`S3ntimentSurveyStore.sol:347`) and `setBatchMaxCards`
  (389) / `revokeBatch` (372): manage batches, not members. `registerBatch` appends to
  `poolBatchIds[poolId]` (line 623) — which *does* grow the enumeration surface for summing
  `cardCount`, but it does not create any member enumeration.

Net effect: the recent additions `rotateMember` / `revokeMember` make `poolMembers` **more mutable**
(can swap/remove individual entries) but give **no counting or enumeration** beyond what `isPoolMember`
already offered. They strictly preserve the non-enumerability of the member set; if anything they make a
naive "current member count" *less* derivable on-chain (a leaf removed by `revokeMember` or rotated away
by `rotateMember` still leaves its `cardCount` in the sum, so `Σ cardCount` drifts further from any
"current" notion).

---

## (d) Backend/API: is there any existing per-pool participant/respondent count endpoint or helper?

**No.** The backend exposes no participant/respondent-count endpoint and no count read-helper:

- `nillcc-backend/src/main.ts` routes (`/pools`, `/surveys`, `/surveys/:id`, `/surveys/:id/score`,
  `/surveys/:id/results`, `/surveys/:surveyId/delegation`, `/builder/register`, `/lit/usage-key`) —
  none return a membership or respondent count. The only contract membership read anywhere in the
  backend is the boolean `isPoolMember` (grep: `main.ts:141-148` commented block and `main.ts:184`
  in the `/score` gate) — an access predicate, not a count.
- `nillcc-backend/src/pool.ctrlr.ts` (`create`/`update`/`registerBuilder`) — creates pools / registers
  builders; no count logic. `survey.ctrlr.ts` handles survey create/get/update/score/results.
- `frontend-respondents/src/humanWallet.factory.ts:27-35` `hasParticipatingAccount(services, poolId)`
  returns a **boolean** ("does the current leaf have a registered pool account") via
  `isPoolMember(poolId, signer)`, not a count.
- `shared/src/shared/survey/survey.factory.ts` (the contract client used by respondents) calls
  `isPoolMember` / signMessage for Lit decryption; no count aggregation. Note the contract layer is a
  separate package (`s3ntiment-contracts`), reachable for reads, but nothing sums `cardCount` today.

So today **no endpoint computes a per-pool participant or respondent count**, on-chain or off-chain. To
get a *registered-member* proxy you would build the `Σ getBatch(...).cardCount` aggregation yourself; to
get *actual respondents* you must count nilDB answer records (off-chain), which is the only source that
satisfies the RFC §7.1 "active respondents" requirement.

---

## Summary of citations

| What | Location |
|---|---|
| `poolMembers` is a private, **non-enumerable** mapping | `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:115` |
| Only membership predicate (no enumeration) | `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:577-579` (`isPoolMember`) |
| Only on-chain counter related to membership: per-batch `cardCount` | `S3ntimentSurveyStore.sol:88` (struct), `:468` (increment in `registerInPool`) |
| `getBatch` returns `cardCount`; `getPoolBatches` enumerates batch ids | `S3ntimentSurveyStore.sol:400-407`, `:410-411` |
| No `getPoolMembers` / member-count function anywhere (confirmed) | grep of `contracts/src`, `contracts/generated` (none) |
| `revokeMember` false-sets without decrementing | `S3ntimentSurveyStore.sol:493-495` |
| `rotateMember` swaps without count change | `S3ntimentSurveyStore.sol:535-568` (`:567-568`) |
| `registerBatch` appends to `poolBatchIds` | `S3ntimentSurveyStore.sol:347`, `:623` |
| Survey participation is off-chain / invisible on-chain | `S3ntimentSurveyStore.sol` header (~lines 17, 33) |
| **Report active respondents, not registered members** (RFC §7.1) | `brain/specs/RFC-deferred-identity-persistence.md:246-247` |
| `isPoolMember` is the single access predicate (RFC §8.1) | `brain/specs/RFC-deferred-identity-persistence.md` §8.1 |
| Handoff: member swap moves membership only; nilDB migration separate | `brain/handoffs/identity-architecture-2026-08-28.md` §10 / §9.3 |
| Backend: no count endpoint; `isPoolMember` boolean only | `nillcc-backend/src/main.ts:184` (gate); `pool.ctrlr.ts`, `survey.ctrlr.ts` |
| `hasParticipatingAccount` returns boolean, not count | `frontend-respondents/src/humanWallet.factory.ts:27-35` |

## Bottom line
- **Direct:** No — no on-chain getter returns a per-pool member/respondent count.
- **Derivable (on-chain):** Yes as a **cumulative registered-member** proxy — `Σ cardCount` over
  `getPoolBatches` — which is monotonically increasing, counts distinct card registrations, and is
  unaffected by (therefore over-counts vs.) revocations/rotations.
- **Actual respondents:** **No**, not from the contract — survey participation is off-chain; a true
  respondent count ("active respondents") must come from **nilDB answer records** (RFC §7.1).
