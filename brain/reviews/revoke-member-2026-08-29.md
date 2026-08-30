# REVIEW — PR #17 `revokeMember` (spec §5-A) — 2026-08-29

**Verdict: PASSES. No blocking issues.**

- **Reviewer:** `builder` (`v4flash-review-revoke-member`, fresh session, diff + contract only).
- **Subject:** PR #17, branch `deepseek/revoke-member`, commit `7ee6769dc`.
- **Gate (independent, reviewer re-ran):** `cd contracts && pnpm exec hardhat test` → **41 passing, 0 failing, exit 0** (prior 36 + 5 new revokeMember tests). Orchestrator independently reconciled 41 passing at the same committed HEAD — no miscount.

## Checklist findings

1. **Correctness & auth — PASS.** `poolMembers` is written in exactly two places: `registerInPool` (→ `true`) and `revokeMember` (→ `false`); no other path can set membership false, so `revokeMember` is genuinely the sole prune path. Guard routes through the existing internal `_requirePoolSafe(poolId)` choke-point; no inline Safe re-check, no new modifier (compliant given the repo's Solidity calldata-parameter restriction on modifiers).
2. **Semantics — PASS.** Idempotent no-op on an already-unregistered member is deliberate and well-documented in the natspec, consistent with the `registerBatch` governance-write convention. Ordering **PoolNotFound-then-NotPoolSafe** preserved via the choke-point.
3. **Zero ABI change — PASS.** Diff only adds `revokeMember` + updates doc comments; no existing external signature/selector touched.
4. **Scope discipline — PASS.** Grepped contract: no events emitted, no `nonce` storage, no `registerInPoolSigned`, no rotation/key-management methods. File emits none, so adding none keeps consistency.
5. **`isPoolMember` single predicate — PASS.** Remains the sole access predicate; `revokeMember` correctly flips it false; no parallel predicate introduced.
6. **Test coverage — PASS.** New `describe('revokeMember (Safe-gated governance)')` covers: (a) Safe revokes a registered member → `isPoolMember` true→false; (b) non-safe reverts `NotPoolSafe`; (c) unknown pool reverts `PoolNotFound`; (d) idempotent re-revoke no-op; (e) per-pool scoping (revoking in one pool doesn't affect another). Style consistent with existing helpers (`signCardMessage`, `env.execute/read`, `loadFixture(deployAll)`).
7. **Quality/style — PASS.** Natspec, naming, and placement consistent with the file.

**Blocking issues:** none.
**Non-blocking:** none reported.
