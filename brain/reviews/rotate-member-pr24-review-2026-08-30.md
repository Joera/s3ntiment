# Independent Review — PR #24 `deepseek/rotate-member` (commit eaf1a287f)

Scope: `S3ntimentSurveyStore.rotateMember` self-authorizing membership rotation +
tests + docs. Reviewed ONLY against the diff artifact `/tmp/rotate-member-pr24.diff`
(implementer worktree not opened).

---

## Per-contract verdicts

1. **MET** — `rotateMember(string poolId, address newLeaf, bytes signature)` added as
   `external`, purely additive. Diff touches only: new errors (`NotPoolMember`,
   `InvalidRotationTarget`), new event (`Rotated`), the one new function, a `MockSMC.rotate`
   test forwarder, 8 tests, and the docs amendment. No existing selector/ABI changed;
   `registerInPool`, `revokeMember`, `isPoolMember`, `registerBatch`, `createSurvey`,
   `getPool`, `revokeBatch` untouched. `ISMC` interface unchanged.

2. **MET** — Authorization exact match to spec:
   - `digest = keccak256(abi.encode(poolId, oldLeaf, newLeaf, address(this), block.chainid))`
   - wrapped `ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" ++ digest)`
   - `oldLeaf = ISMC(msg.sender).owner()` (same identity resolution as registerInPool)
   - `if (signer != oldLeaf) revert InvalidSignature()`
   - `if (!poolMembers[poolId][oldLeaf]) revert NotPoolMember()`
   - `if (newLeaf == address(0)) revert InvalidRotationTarget()`
   - atomic `oldLeaf=false; newLeaf=true; emit Rotated(poolId, oldLeaf, newLeaf)`

3. **MET** — Guarding: `pool-existence check (PoolNotFound when pools[poolId].safe==0)`
   present; NOT routed through `_requirePoolSafe` (direct `pools[poolId].safe` read, same
   self-service posture as registerInPool). Replay/per-path hardening: digest bound to
   chain + contract + poolId + newLeaf, and old leaf removed after first swap so replay of the
   same signed tuple hits `NotPoolMember`.

4. **MET** — Signature verified via `_recoverSigner` (shared ecrecover helper, the ERC-1056
   authority idiom the audit earmarked), not pass-through. Wrong-signer fails
   (`InvalidSignature`). Recovered address non-zero is validated implicitly: `oldLeaf` is
   checked non-zero before the `signer != oldLeaf` comparison, so a zero ecrecover result
   (`0 != oldLeaf`) reverts `InvalidSignature`. Recovered signer must be the member being
   rotated out (`signer == oldLeaf` AND `poolMembers[poolId][oldLeaf] == true`).

5. **MET** — Authority binding correct: authorized party is the current member (`oldLeaf`)
   resolved from `ISMC(msg.sender).owner()`; the acting SMC's owner is that member; the old
   stealth key proves control via the signature; SMC-owner check ties it to the live member
   slot. A holder of an unrelated leaf cannot rotate another member's membership away.

6. **MET** — `emit Rotated(poolId, oldLeaf, newLeaf)` with correct args; event added
   additively (only the library-version comment line was amended).

7. **MET** — All six required classes covered (+2 extra binding tests), 8 new tests:
   (a) happy path E→S atomic — yes; (b) wrong-signer → `InvalidSignature` — yes;
   (c) replay of spent tuple → `NotPoolMember` (old leaf no longer member) — yes;
   (d) non-member stranger → `NotPoolMember` AND non-owner key → `InvalidSignature` — yes;
   (e) zero `newLeaf` → `InvalidRotationTarget` — yes; (f) unknown pool → `PoolNotFound` — yes.
   Happy path + wrong signer + replay all asserted. Setup mirrors registerInPool
   (card + SMC-owner-as-leaf). Off-chain digest builder uses `encodeAbiParameters`
   (string,address,address,address,uint256) + EIP-191 prefix and signs the hash — byte-consistent
   with on-chain.

8. **MET (implementer-reported, not independently re-run)** — Implementer reports 75 passing
   vs 67 baseline (+8 = the 8 new tests), all pre-existing green. I did not open the worktree
   to re-run (per review isolation). Observed added test-case count in the diff: **8**.

9. **MET** — Method-surface spec §10 amendment records rotateMember signature, auth model,
   guard/replay rationale, and explicitly supersedes the earlier "add nothing for rotation"
   stance, tying it to RFC-001 §7.3 / §11 tension. nilDB `E → S` migration explicitly out of
   scope in code, spec, and report.

---

## Prioritized issues

**Blocking**
- None.

**Non-blocking**
1. No guard against `newLeaf` already being a member — rotation to an already-member address
   silently removes the old leaf only (harmless, not exploitable; the new-leaf membership is a
   no-op). Consider a "already member" revert for intent-clarity.
2. No explicit `oldLeaf != newLeaf` guard — self-rotation (`newLeaf == oldLeaf`) is a no-op
   that passes. Not a security issue.
3. `NotPoolMember()` error name is mildly awkward English vs the codebase's `NotPoolMember`
   pattern; cosmetic only.
4. Contract item 8 is verified only by the implementer's report (67→75); a CI/gate transcript
   in the PR body would make it independently auditable.

---

## Overall recommendation

**READY-TO-MERGE.**

The implementation matches the acceptance contract on all 9 criteria. The entity-identity
seam (card/nullifier-bound registerInPool cannot register a derived leaf after the entry card is
spent) is resolved with a well-scoped, additive, authorization-hardened swap: signature of the
old stealth checked (ecrecover + EIP-191, chain/contract/pool-bound, old-leaf-removed-after-swap
replay bound), correct SMC-owner authority binding, and complete test coverage of the required
happy/wrong-signer/replay paths plus zero-target, non-member, and unknown-pool reverts. The only
notes are non-blocking hardening nits.
