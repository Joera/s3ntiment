# rotateMember — self-authorizing on-chain membership rotation (impl report)

- **Date:** 2026-08-30
- **Branch:** `deepseek/rotate-member`
- **Commit:** `eaf1a287f` (`feat(contracts): add self-authorizing rotateMember membership rotation`)
- **PR:** deepseek/rotate-member → `Joera/s3ntiment` (PR #24)
- **Worktree:** `~/code/worktrees/s3ntiment-rotate-member`
- **Gate:** contract test suite (`pnpm --dir contracts test`). **67 passing at baseline → 75 passing at committed HEAD** (+8 `rotateMember` tests). All existing tests remain green (additive only).

## What was added

`S3ntimentSurveyStore.rotateMember(string poolId, address newLeaf, bytes signature) external` — a
self-authorizing, self-service method that lets the **current member leaf** rotate its own on-chain
membership out to a **fresh derived leaf** in one atomic call. This is the concrete mechanism for the
RFC-001 §7.3 "second transaction" (anchor-less persist) seam: the only registration fn,
`registerInPool`, is card/nullifier-bound and reverts `NullifierAlreadyUsed` once the entry card is
spent, so a fresh derived leaf `S` cannot register at persist without this swap. It resolves the
RFC-001 §11 "add nothing for rotation" tension for the bootstrap→derived path.

Supporting changes (all scoped to this row):
- `Rotated(string poolId, address oldLeaf, address newLeaf)` event + `NotPoolMember()` /
  `InvalidRotationTarget()` errors (plus reuse of existing `PoolNotFound`, `InvalidMemberAddress`,
  `InvalidSignature`).
- `MockSMC.rotate(...)` test-only forwarder so tests can drive the SMC path.
- 8 new tests in `contracts/test/S3ntimentSurveyStore.test.ts`.
- Dated amendment (§10) to `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md` recording
  the signature + authorization model and the RFC tension it resolves.

## Authorization model ("signature of old stealth checked, then swap")

Mirrors the **exact abi.encode + EIP-191 personal-sign convention** that `registerInPool` uses for cards:

```
digest        = keccak256(abi.encode(poolId, oldLeaf, newLeaf, address(this), block.chainid))
ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" ++ digest)
oldLeaf       = ISMC(msg.sender).owner()          // same identity resolution as registerInPool
signer        = ecrecover(ethSignedHash, signature)
```

Guards, in order (mirroring registerInPool's pool-existence guard + guard-before-write ordering):
1. `pools[poolId].safe == address(0)` → `PoolNotFound` (self-service like registerInPool — **NOT**
   routed through the `_requirePoolSafe` choke-point, which is reserved for operator/Safe store ops;
   `registerInPool` is not Safe-gated either, confirmed against source).
2. `oldLeaf == address(0)` → `InvalidMemberAddress`; `newLeaf == address(0)` → `InvalidRotationTarget`.
3. `signer == oldLeaf` required (`signer != oldLeaf` → `InvalidSignature`).
4. `poolMembers[poolId][oldLeaf] == true` required (`→ NotPoolMember`).
5. Atomic swap: `poolMembers[poolId][oldLeaf] = false; poolMembers[poolId][newLeaf] = true;
   emit Rotated(poolId, oldLeaf, newLeaf)`.

## Test class added (8)

- rotate current member → new leaf succeeds: old leaf `isPoolMember` false, new leaf true.
- caller not controlling old leaf (signature from a different key that is not the SMC owner) → reverts.
- old leaf is NOT a member → reverts `NotPoolMember`.
- `newLeaf == address(0)` → reverts `InvalidRotationTarget`.
- replay after a successful rotate (same signature) → reverts `NotPoolMember` (old leaf no longer member).
- wrong `poolId` in digest → reverts (signature binding works).
- wrong `chainId` in digest → reverts (chain binding works).
- unknown pool → reverts `PoolNotFound`.

## Security review notes (for the independent reviewer)

- **Authorization is scope-limited to the member's own leaf.** Recovered `signer` must equal
  `ISMC(msg.sender).owner()`, so only the member's own key driving its own SMC can rotate that
  membership. A holder of any single, unrelated leaf cannot rotate a different member's membership
  away — the wrong-signer test proves it.
- **Replay is naturally bounded.** After a successful rotate, `poolMembers[poolId][oldLeaf]` is `false`,
  so re-calling with the same signature reverts at `NotPoolMember`. No `nonce` storage added — the
  surface stays minimal. Cross-contract / cross-chain / cross-pool replay is blocked by the digest
  binding `address(this) + block.chainid + poolId` (chain and wrong-pool tests prove it).
- **nilDB migration is explicitly OUT of contract scope.** The contract swap moves **on-chain
  membership only**. The nilDB per-leaf immutable `did:key` owner record migration (`E → S`, RFC-001 §6)
  is still required separately — `_owner` immutability is unchanged; ACL-grant / delete+recreate
  mechanics still apply. Stateful in the PR body and this report.

## Scope guard

Untouched: `frontend-respondents`, `shared`, `nillcc-backend`, all other contract methods, and the
existing `registerInPool` / `revokeMember` behavior. This PR is only: the one new method + its tests +
the docs amendment. Zero change to existing method selectors / ABI.
