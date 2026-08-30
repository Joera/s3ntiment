# PR #6 Review — Shared card-encoding package (cross-cutting seam, Pattern 1)

- **Reviewed branch / commit:** `deepseek/shared-encoding` @ `272a122a3058558448008d46e995c3c8079fc502` (PR #6, vs base `main`)
- **Scope of judgment:** the PR diff fetched via `gh pr diff 6` (the neutral artifact), checked against the acceptance contract. Repo `main` read only for context; implementer worktree untouched.
- **Verdict:** ✅ APPROVED

## Summary

The PR consolidates the card digest + EIP-191 signing bytes (the four previously-independent implementations: `S3ntimentSurveyStore.sol`, the contract test, `invitation.factory.ts`, `card.factory.ts`) into one leaf-level, viem-only shared module and pins the equivalence with a seam test. The diff is additive and behavior-preserving for both frontends.

## Acceptance contract → findings

1. **Shared module `shared/src/shared/invites/encoding.ts`** ✅
   - `cardMessageHash` = `keccak256(encodePacked(['string','string','address'],[nullifier,'|',batchId]))` — matches the on-chain oracle exactly (`S3ntimentSurveyStore.registerInPool`: `keccak256(abi.encodePacked(nullifier,"|",batchId))`).
   - `ethSignedMessageHash` = `keccak256(concat([\x19Ethereum Signed Message:\n32, messageHash]))` — matches the contract's `ethSignedHash`.
   - `signCardMessage` signs `ethSignedMessageHash` via `account.sign({hash})`, recoverable to `batchId` by `recoverMessageAddress({message:{raw: cardMessageHash}, signature})`, and satisfying `registerInPool`.
   - Leaf-level (imports only `viem` + a type-only `LocalAccount`), ESM/NodeNext (`"type":"module"`, tsconfig `module`/`moduleResolution` NodeNext), no Lit/Nillion/d3.
   - **Subpath export:** `shared/package.json` adds `"./invites/encoding"` → `./dist/shared/invites/encoding.js` (import + types). `contracts/package.json` adds `"@s3ntiment/shared": "workspace:*"` and the lockfile resolves it to `link:../shared`. Hardhat node-test-runner imports resolve via Node ESM to the built dist; `shared/tsconfig.json` includes `src/shared/**/*` so `encoding.js` is emitted to `dist/shared/invites/encoding.js`. Resolution wiring is correct.

2. **Contract test refactor** ✅ — inline `cardMessageHash`/`signCard` (old L24-44) deleted; `S3ntimentSurveyStore.test.ts` now imports `signCardMessage` from the shared subpath. All call sites (including the wrong-signer and double-use/EoA-revert cases) are updated 1:1 with identical signing bytes; all 30 existing tests preserve intent.

3. **`invitation.factory.ts.generateCardSecrets`** ✅ — replaced the inline `encodePacked`+`keccak256`+`signMessage({raw})` with `signCardMessage(batchAccount, nullifier, batch.id)` (imported from `@s3ntiment/shared` root). viem's `signMessage({message:{raw:32-byte}})` applies the same `\x19Ethereum Signed Message:\n32` prefix, so the new path produces **byte-identical** EIP-191 signatures recoverable to `batch.id`. Retained `keccak256`,`toBytes` (still used at `batchPrivKey` derivation); removed `encodePacked`,`toHex` are no longer used — no unused-import drift.

4. **`card.factory.ts`** ✅ — hand-rolled `encodeNullifierBatchCombo` deleted; `parseCardURL` now uses `cardMessageHash`, byte-equivalent to the old UTF-8-concat form (I verified the byte layouts match), so `surveyOwner` recovery is unchanged. `@s3ntiment/shared/invites/index.ts` re-exports the new module.

5. **Pinning test `contracts/test/encoding.seam.test.ts`** ✅ — 6 tests (30 + 6 = 36). It pins against an **independent** hand-rolled reference impl (`legacyEncodeNullifierBatchCombo`, TextEncoder+hex, commented as legacy), NOT a mirror of the new code — non-tautological. It also carries a hardcoded regression-canary digest (`0x43c87d…c785` for `'A'+'a'.repeat(21)` / `0x11…11` batch); I independently recomputed it with js-sha3 and it matches exactly, so the pin is genuine (not self-referential). Round-trip recovery is asserted both via `recoverMessageAddress` and on-chain through `registerInPool`, plus a negative case (wrong-signer → `InvalidSignature`).

## Gates

- Orchestrator-verified at the exact head commit: hardhat = 36 passing (30+6), `pnpm build:shared` green, `frontend-organiser` vite build green. Structural review corroborates these (subpath export, tsconfig coverage, and dependency wiring are all present and consistent).

## Non-blockers (no change required for approval)

- `account.sign!` non-null assertion in `signCardMessage` leans on the invariant that passed accounts are always `privateKeyToAccount`/`createBatchWallet` (which do carry `sign`). Safe here, but a runtime guard or a narrower param type (`PrivateKeyAccount`) would be more defensive. Cosmetic.
- `pnpm-lock.yaml` contains unrelated additive churn (`@0no-co/graphqlsp`/`@gql.tada/*` snapshots under `typescript@5.8.3`) — noise, harmless.
- `shared` `dist/` is not committed, and the contracts tests resolve `@s3ntiment/shared/invites/encoding` to the built dist. This matches the package's existing consumption pattern, but CI/ordering must ensure `pnpm build:shared` runs before `hardhat test` (no workflow enforces it today). Worth documenting; not a defect in this diff.

## Conclusion

The module correctly satisfies both the viem and Solidity oracles; both frontend consumers were refactored onto the same bytes with no behavior drift; the shared piece is multi-consumer importable (hardhat + Vite) with a properly wired `workspace:*` dependency; and the seam test genuinely pins the legacy form via an independent implementation and a verified canary. No blockers found.
