# §5-A — Safe-gated governance prune `revokeMember`

Implements **§5-A** from `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md`:
a new Safe-gated governance write that removes a member from a pool.

## Branch
`deepseek/revoke-member` (based on `origin/main` @ `b5e622671`, which already contains the merged D3 change)

## Commit
`7ee6769dc` — `feat(S3ntimentSurveyStore): add Safe-gated revokeMember (spec §5-A)`

## PR
opened against `origin/main` (see PR number reported alongside).

## What changed

**`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`**

Added one new external function — no other external signature changed (zero ABI
change to existing methods), no new storage, no events (the file emits none; §2 kept).

```solidity
function revokeMember(string memory poolId, address member) external {
    _requirePoolSafe(poolId);
    poolMembers[poolId][member] = false;
}
```

- **Auth routing**: guards through the existing `_requirePoolSafe(poolId)` internal
  choke-point from the D3 refactor. The spec's literal `onlySafe(poolId)` is *not*
  a Solidity modifier here (a `string memory`-modifier can't compile against the
  repo's calldata resolution), and the pool's Safe is *not* re-checked inline — the
  shared choke-point enforces `PoolNotFound()`-then-`NotPoolSafe()` ordering, so no
  privileged path bypasses a Single Safe-gated write.
- **Semantics**: after the auth gate, `poolMembers[poolId][member] = false`. This is
  idempotent — revoking an already-unregistered member is a safe no-op (no revert),
  consistent with governance writes elsewhere in the file (`registerBatch` similarly
  does not require a pre-existing entry; there's no separate membership-not-found
  error in the contract). The ordering is `PoolNotFound()` (unknown pool) before
  `NotPoolSafe()` (non-safe caller), matching `_requirePoolSafe`.
- **Doc header**: the authority doc-comment header now lists `revokeMember` alongside
  the other Safe-gated writes through the choke-point and marks `revokeMember()` as
  Safe-executed (governance).

**`contracts/test/S3ntimentSurveyStore.test.ts`**

New `describe('revokeMember (Safe-gated governance)')` block (tests below).

No events were added; no `registerInPoolSigned`, no nonce storage, no rotation
methods were added (explicitly out of scope).

## Tests added

- A pool Safe can revoke a registered member; `isPoolMember` then returns `false`.
- `revokeMember` by a non-safe caller reverts `NotPoolSafe()`.
- `revokeMember` for an unknown pool reverts `PoolNotFound()`.
- Revoking an already-unregistered member is handled sanely as an **idempotent no-op**
  (documented choice above) — the second revoke succeeds and membership stays `false`.
- Bonus scoping test: revoking a member from one pool does not affect that member's
  membership in another pool.

## Test gate

Observed on the committed HEAD (`7ee6769dc`) from the `contracts` workspace of the
worktree:

```
cd contracts && pnpm exec hardhat test
```

Result: **41 passing, 0 failing** (nodejs test runner; the prior 36 stay green plus
5 new revokeMember tests). Exit code 0.
