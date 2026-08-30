# REVIEW — PR #25 `deepseek/get-pool-member-count` (commit 6c6b5b194)

Independent review. Inputs: the PR diff artifact only. Reviewer did not edit code, did not
open the implementer's worktree/branch. Scope: per-pool registered-member count
(`getPoolMemberCount`) backed by a maintained `poolMemberCounts` counter.

## Per-contract verdicts

### 1. Additive storage + read, no ABI/event/signature change — **MET**
- New `mapping(string => uint256) private poolMemberCounts;` added adjacent to `poolMembers`.
- New `function getPoolMemberCount(string memory poolId) external view returns (uint256)` added.
- `registerInPool` / `revokeMember` / `rotateMember` / `isPoolMember` signatures unchanged
  (only bodies modified).
- No event definitions added/removed/changed; `emit Rotated(...)` untouched.
- Spec declares the mapping `private` (diff line "mapping(string => uint256) private
  poolMemberCounts;") — the external getter is the ABI surface, consistent with the contract.

### 2. Increment exactly once per successful registration, after guards — **MET**
`registerInPool`:
```
if (poolWallet == address(0)) revert InvalidMemberAddress();
if (poolMembers[poolId][poolWallet]) revert AlreadyPoolMember();
poolMembers[poolId][poolWallet] = true;
poolMemberCounts[poolId]++;   // last statement, after both guards
```
Increment is the final statement, placed after `InvalidMemberAddress`/`AlreadyPoolMember`
guards at the same commit point as `batch.cardCount`. A reverting registration rolls the whole
tx back (incl. the increment) → no double-count. Exactly-once.

### 3. revokeMember decrements only if actually a member — **MET**
```
if (poolMembers[poolId][member]) {
    poolMembers[poolId][member] = false;
    poolMemberCounts[poolId]--;
}
```
Guarded write + guarded decrement. Documented idempotent no-op (double revoke / never-registered
member) cannot underflow or double-decrement the `uint256`.

### 4. rotateMember net-delta maintenance, all three branches, no underflow — **MET**
```
bool newLeafAlreadyMember = poolMembers[poolId][newLeaf];
poolMembers[poolId][oldLeaf] = false;
poolMembers[poolId][newLeaf] = true;
if (oldLeaf != newLeaf) {
    poolMemberCounts[poolId]--;
    if (!newLeafAlreadyMember) poolMemberCounts[poolId]++;
}
```
- oldLeaf is verified a member by the `NotPoolMember` guard → decrement safe (count ≥ 1), no underflow.
- Swap to non-member newLeaf: −1 then +1 → net-zero. ✓
- Rotate to already-member newLeaf (Case-2 cleanup): −1, no +1 → decreases by exactly 1. ✓
- Self-rotation (`newLeaf == oldLeaf`): `oldLeaf != newLeaf` is false → block skipped →
  count unchanged, no double-count of the single member. ✓

### 5. Unknown pool → 0, no revert, no enumeration — **MET**
`getPoolMemberCount` returns `poolMemberCounts[poolId]`, which defaults to 0 for an unmapped
key (no revert), matching the documented convention (getPoolSurveys/getPoolBatches return empty,
isPoolMember returns false) as opposed to getPool's `PoolNotFound`. No loop/enumeration anywhere.

### 6. Test coverage (7 tests) — **MET** (with a test-gap note)
All 7 required behaviors each have a dedicated test:
1. fresh/unknown pool → 0 (also checks a freshly-created empty pool) — present.
2. increment per distinct leaf (3 members, asserts 1/2/3) — present.
3. `AlreadyPoolMember` revert does NOT double-increment — present.
4. `revokeMember` decrements — present.
5. idempotent (already-false) revoke does NOT underflow/double-decrement — present.
6. rotate to non-member newLeaf → count unchanged �� present.
7. rotate to already-member newLeaf (Case-2) → count decreases by 1 — present.

*Note:* self-rotation is correctly **handled in code** (the `oldLeaf != newLeaf` guard) and
documented in spec §11 + handoff §9.5, but has **no dedicated test** exercising that exact
branch. Non-blocking coverage gap.

### 7. Docs — **MET**
- Method-surface spec §11 AMENDMENT (2026-08-30) documents signature, unknown-pool convention,
  and all maintenance points.
- Handoff §9.5 (2026-08-30) reflects the implemented behavior and design intent.

### 8. Gate — **MET (implementer-reported)**
Implementer reports 82 passing at committed HEAD (75 baseline after PR #24 + 7 new
`getPoolMemberCount` tests). Diff confirms exactly 7 new tests. Reviewer did not re-run the gate
(taken as implementer-reported per contract).

## Issue list

### Blocking
- None.

### Non-blocking
1. **No dedicated self-rotation test** — the `oldLeaf == newLeaf` branch is guarded/correct in
   code and documented, but not exercised by a test. Recommend adding one to lock the behavior.
2. **Storage-layout / upgradeability confirmation (verify, not a code bug)** — the new mapping is
   inserted immediately after `poolMembers`. I could not open the worktree to inspect whether it
   is truly appended at the END of the state-variable layout. If the contract is an upgradeable
   proxy (UUPS/transparent), confirm the new variable is at the tail so existing storage slots are
   not shifted. From the diff alone this is additive, but it should be confirmed for proxy safety.
3. **Case-2 rotate path not independently verifiable from the diff** — only the tail of
   `rotateMember` appears in the diff (the earlier guards/validation are outside the hunk). The
   already-member rotate succeeds per the implementer's green gate and the spec's Case-2 doc, but
   the pre-write guards (e.g., any rejection of rotation onto an existing member) were not visible
   to the reviewer. Relying on the reported 82-passing gate plus the test's post-condition asserts.

## Recommendation
**READY-TO-MERGE** — all 8 acceptance contracts assessed **MET**. Core counter-maintenance logic is
correct in all documented branches (register/revoke/rotate net-delta/self-rotation) with no
underflow or double-count paths. The three non-blocking notes are verification/coverage follow-ups,
not functional defects.
