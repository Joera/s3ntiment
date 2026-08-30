# Shared Card-Encoding Package — Seam Coverage (Pattern 1)

**Date:** 2026-08-28
**Branch:** `deepseek/shared-encoding` (off `main` `b10cb7d26`)
**Commit:** `272a122a3` — "feat(shared): unified card encoding module + refactor consumers (seam coverage)"
**PR:** https://github.com/Joera/s3ntiment/pull/6 (opened; human merges)
**Worktree only:** `/home/joera/code/worktrees/s3ntiment-shared-encoding`. `main` untouched.
**Upstream context:** `brain/audits/seam-coverage-exploration-2026-08-28.md`

---

## 1. What this does

This is the seam-coverage task from the exploration audit: put the card-digest + EIP-191
signing bytes in **one** shared, tested module so the Hardhat contract tests and both
frontends import the *same* logic, and pin that equivalence with a test. It removes the
**four independent implementations** of `keccak256(abi.encodePacked(nullifier, "|", batchId))`:

| # | Old impl | Moved to |
|---|----------|----------|
| 1 | `S3ntimentSurveyStore.sol` `registerInPool` (Solidity) | stays (the on-chain oracle) |
| 2 | `contracts/test/S3ntimentSurveyStore.test.ts` inline `cardMessageHash`/`signCard` | `shared/invites/encoding.ts` |
| 3 | `frontend-organiser/.../invitation.factory.ts` `generateCardSecrets` (viem `encodePacked`+`signMessage`) | `shared/invites/encoding.ts` |
| 4 | `shared/.../card.factory.ts` hand-rolled `encodeNullifierBatchCombo` | `shared/invites/encoding.ts` |

The on-chain oracle contract is unchanged and remains the ground truth; the shared module
must produce bytes that the contract accepts.

## 2. The new shared module

`shared/src/shared/invites/encoding.ts` — **leaf-level, viem-only** (no Lit/Nillion/d3), ESM/NodeNext.

- `cardMessageHash(nullifier, batchId)` → `keccak256(encodePacked(['string','string','address'], [nullifier,'|',batchId]))`
- `ethSignedMessageHash(messageHash)` → `keccak256(concat([stringToBytes('\x19Ethereum Signed Message:\n32'), toBytes(messageHash)]))`
- `signCardMessage(account, nullifier, batchId)` → `account.sign({hash: ethSignedMessageHash(...)})`, recoverable to `batchId` by
  `recoverMessageAddress({message:{raw:cardMessageHash(...)}, signature})` and satisfying on-chain `registerInPool`.

Re-exported from `shared/src/shared/invites/index.ts` (so the root `@s3ntiment/shared` exposes it to the
Vite frontends) and from a new subpath export `@s3ntiment/shared/invites/encoding` (so the Hardhat
node-test-runner can import the leaf without loading the full Lit/Nillion index).

## 3. Consumers refactored

- **`contracts/test/S3ntimentSurveyStore.test.ts`**: deleted the inline `cardMessageHash`/`signCard`
  (old L24–44); now `import {signCardMessage} from '@s3ntiment/shared/invites/encoding'`. The local
  `createBatchWallet` (deterministic privateKeyToAccount helper) stays. All call sites changed
  `signCard(batch, n, addr)` → `signCardMessage(batch, n, addr)` — identical signature, so all 30 tests
  preserve intent (contract remains the oracle; recovered signer must equal `batchId`).
- **`frontend-organiser/src/factories/invitation.factory.ts`** `generateCardSecrets`: replaced
  `encodePacked`+`keccak256`+`batchAccount.signMessage({message:{raw}})` with shared `signCardMessage`.
  The QR `sig` is still a valid EIP-191 signature recoverable to `batch.id`.
- **`shared/src/shared/invites/card.factory.ts`** `parseCardURL`: replaced the private hand-rolled
  `encodeNullifierBatchCombo` with shared `cardMessageHash`. `recoverMessageAddress` still recovers the
  same `surveyOwner`. Dropped now-unused `encodePacked`/`keccak256`/`toHex` imports.
- **`contracts/package.json` (+ `pnpm-lock.yaml`)**: added `@s3ntiment/shared: workspace:*` as a devDependency
  so the test runner can resolve the subpath.

## 4. Pinning / equivalence test — where it lives

`contracts/test/encoding.seam.test.ts` — runs in the **existing green Hardhat harness** (`hardhat test`,
same node-test-runner / earl / fixture stack as `S3ntimentSurveyStore.test.ts`). It proves:

- (a) `cardMessageHash` equals the **legacy hand-rolled byte-concat form** — the old
  `encodeNullifierBatchCombo` (UTF-8 nullifier ++ "|" ++ raw 20-byte batchId) is kept **inline as a reference
  implementation** with a comment stating it is the legacy form being pinned.
- (b) `signCardMessage` → `recoverMessageAddress({message:{raw:cardMessageHash}, signature})` round-trips to
  `batchId` (this is the invitation.factory / QR-recovery path).
- (c) **On-chain**: via `registerInPool` (through `MockSMC`), the shared-encoding signature is accepted
  (recovered signer == batchId), and a wrong-signer signature reverts with `InvalidSignature()`. This proves
  the on-chain `messageHash`/`ethSignedHash` match the shared module (the contract is the oracle).
- Bonus: a deterministic digest regression canary (fixed nullifier+batchId → fixed keccak).

## 5. Gate results (REAL, same command/file-set/commit `272a122a3`)

| Gate | Command | Result |
|---|---|---|
| Contracts test suite (collect-only count from the runner, not grep) | `pnpm test` (hardhat test) | **36 collected / 36 passing** — 30 pre-existing `S3ntimentSurveyStore` tests + 6 new `encoding` seam tests |
| Shared build | `pnpm build:shared` (`tsc`) | **green** |
| Frontend-organiser | `pnpm build` (`vite build`) | **green**, built in ~1m17s |

Notes:
- `frontend-organiser` has **no** `tsc`/typecheck script; `vite build` is the lightest gate that exists and it
  completed **without** requiring env secrets (Vite/esbuild does not fail on missing `import.meta.env` — they
  build as `undefined`). So I ran the real build and it passed.
- `build:shared` also triggers `contracts prepare` → `hardhat compile`, which compiled the 2 Solidity files
  successfully.
- `frontend-respondents` build was not part of the required gates, but its shared dependency
  (`card.factory.ts`) is fully type-checked by `build:shared`.

## 6. Files changed (commit `272a122a3`)

- `shared/src/shared/invites/encoding.ts` (new)
- `shared/src/shared/invites/index.ts` (re-export)
- `shared/package.json` (subpath export `./invites/encoding`)
- `shared/src/shared/invites/card.factory.ts` (use `cardMessageHash`)
- `frontend-organiser/src/factories/invitation.factory.ts` (use `signCardMessage`)
- `contracts/test/S3ntimentSurveyStore.test.ts` (import from shared)
- `contracts/test/encoding.seam.test.ts` (new pinning test)
- `contracts/package.json` (`@s3ntiment/shared` workspace dep)
- `pnpm-lock.yaml`

## 7. Follow-ups (out of scope for this task)

- **Pattern 2** (ABI snapshot): cross-check `deployments/base/S3ntimentSurveyStore.json` (what frontends
  import) against the compiled typed ABI — still unverified.
- **Pattern 3** (local-Hardhat E2E): drive `Card.register` through shared services against a local node —
  orthogonal to this encoding seam.
- Optionally promote the same `cardMessageHash` into the Solidity oracle's own derived `messageHash` view, if
  a read-side seam is ever desired.
