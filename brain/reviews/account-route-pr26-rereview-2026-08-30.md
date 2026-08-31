# PR #26 RE-REVIEW (V2) — /account secure-your-stealth-account flow (E→S rotate)
- PR: feat(frontend-respondents): /account (secure your stealth account, E→S rotate)
- Reviewed: diff main...HEAD bed817e6b (`deepseek/account-route`), v2 = /tmp/account-route-pr26-v2.diff
- Fix commit: bed817e6b "close 3 BLOCKING safety defects (PR #26 review)" — touches ONLY account-ctrlr.ts, account-ctrlr.test.ts, nilldb.user.service.ts
- Reviewer: DeepSeek V4 Flash 0731 (independent — diff + contract + prior review only, never edits)
- Contract grounded: contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol rotateMember at :552-598 (unchanged)

## Verdict summary
All three BLOCKING safety defects from the prior review are **RESOLVED**. The E→S rotate
signing shape is byte-for-byte unchanged and still matches Solidity; route/CTA/storage/
humanWallet refactor are unchanged; all affected tests pass (6 tests in account-ctrlr.test.ts
+ 46 across completed-ctrlr/stores/humanWallet.factory, zero failures) and no NEW blocking
issues were introduced. **No regressions observed.** → **READY-TO-MERGE: YES.**

## Per-blocker verdict

### BLOCKING 1 — recreate-then-delete ordering → RESOLVED
- `migrateRecordsToDerivedLeaf` now RECREATES under S FIRST (`createData` loop,
  account-ctrlr.ts:279-296) and only then DELETEs E's copies (`deleteOwnedData` loop,
  account-ctrlr.ts:301-317). A failed delete after a successful recreate returns
  `{ok:true, reason:'migration_delete_duplicate_left'}` and ends on S — a harmless
  duplicate in E, never an orphan.
- Ordering in `secureWithEmailWallet`: migration runs FIRST (account-ctrlr.ts:193), the
  on-chain rotate AFTER (:209).
- Test `keeps E IN FULL (delete never runs) when recreating records under S throws`
  (account-ctrlr.test.ts:140-182) asserts `deleteOwnedData` was **never called**
  (:154), `createData` called once, `bootstrapKept()===true` (E retained), no anchor,
  `loadDerivedSKeyFromStorage()===null`, and `write` **not** called (no rotate). E's
  records survive because the delete step never committed.

### BLOCKING 2 — listing errors must not masquerade as success → RESOLVED
- `listOwnedBySurvey` (shared nilldb.user.service.ts:198-222) no longer swallows errors
  as `[]` — the old `try/catch → return []` is removed, so it **throws** on a listing/
  read failure. Doc comment at :192-197 states the safety intent explicitly.
- `migrateRecordsToDerivedLeaf` wraps the list call in its own try/catch
  (account-ctrlr.ts:267-269) returning a **distinct** `{ok:false, reason:'migration_list_failed'}`
  (no silent-`[]` path); `secureWithEmailWallet` propagates it (:194-195) → `{ok:false}`
  and aborts before any wipe / anchor / rotate.
- Test (account-ctrlr.test.ts:184-217): listing fails → `ok:false`, `reason==='migration_list_failed'`,
  no `createData` / `deleteOwnedData` / `write`, `bootstrapE` retained, no anchor.

### BLOCKING 3 — canonical ordering + honest failure copy → RESOLVED
- Canonical order in `secureWithEmailWallet`: derive S → nilDB migrate E→S
  (recreate-then-delete) FIRST (:193) → `rotateMember(poolId, S, sigByOldLeaf)` via the
  Pimlico write path (:209-223) → ONLY on full success wipe E + persist S + set
  anchor_address (:225-227). On ANY failure the method returns before :225 — E kept,
  no wipe, no anchor, on-chain untouched (a migration failure returns at :194 before the
  rotate write, so E remains the on-chain member/signer and can still read its retained
  records — closing the earlier "E left unable to read its own data" issue).
- `no_active_survey` guard moved to BEFORE migration/rotate (:187) — refused before any change.
- Happy-path test asserts ordering explicitly via `invocationCallOrder`
  (account-ctrlr.test.ts:122-127): `createOrder < writeOrder`, `deleteOrder < writeOrder`,
  `deleteOrder > createOrder`; plus success side-effects (anchor persisted :106-110).
- Failure copy (`failureCopy`, account-ctrlr.ts:147-150): "We kept your device's existing
  key and set no recovery anchor — nothing was wiped or replaced." The prior overstating
  string "your existing access is unchanged" is **removed**; the copy is conservative and
  does not promise "unchanged access" (nilDB records may already have been re-created
  under S), so it does not overstate safety.

## Signing shape + contract re-verification (must remain unchanged)
- rotate-member.signing.ts is **identical** between the OLD (c1c0466ca) and v2 diffs —
  `digest = keccak256(abi.encode(poolId, oldLeaf, newLeaf, storeAddress, chainId))` then
  `ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + digest)`, signed via
  `signer.sign({ hash })` by the re-established old leaf. Matches S3ntimentSurveyStore.sol
  `rotateMember` (:568-578: same `abi.encode(poolId, oldLeaf, newLeaf, address(this),
  block.chainid)` field order, same EIP-191 wrap, `signer != oldLeaf → revert`,
  `!poolMembers[poolId][oldLeaf] → NotPoolMember`). viem `encodeAbiParameters('string,
  address,address,address,uint256')` ≡ Solidity `abi.encode` for the dynamic string.
  Contract unchanged since PR #24 — no re-verification issues.
- Route registration (router.ts:101-108), results-page CTA gating
  (`anchor_address === undefined`, completed-ctrlr.ts), storage helpers (storage.ts) and
  the humanWallet.factory refactor are all unchanged between c1c0466ca and bed817e6b.

## NEW blocking issues introduced by the fix
- None.

## Non-blocking notes
- On a partial recreate failure (record N created under S, record N+1 throws), record N
  exists under both E and S; E is retained and no wipe/rotate occurs, so nothing is
  orphaned — acceptable.
- `chainId` still falls back to hardcoded `8453` (account-ctrlr.ts:213) — correct for the
  shipped network, would silently mismatch off-base (carried over from prior review).
- `failureCopy` message "nothing was wiped or replaced" only ever renders on paths that
  genuinely did not wipe/replace; the successful-but-duplicate-left path returns `ok:true`
  and shows the success copy, so the wording is accurate for all failure reachable states.
- `anchor_address` stores the raw email string — fine as a "device secured" flag, though
  the field name slightly over-claims "address" (carried note).

## Final
READY-TO-MERGE: **YES**
