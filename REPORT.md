# card-v2 — per-pool nullifier binding, chain/contract binding, zero-owner guard

Implements audit findings **#1**, **#6**, and **#7** from the s3ntiment card
format review: a BREAKING change to the card **(nullifier, batchId, signature)**
message format. Scope is limited to exactly these three findings.

## Branch
`deepseek/card-v2` (based on `origin/main` @ `e18a8374c`)

## Commit
(see final commit hash reported alongside)

## PR
opened against `origin/main` (PR number reported alongside).

---

## The three findings

- **#1 — bind pool into the card message + scope the nullifier per pool.**
  The old digest `keccak256(abi.encodePacked(nullifier, "|", batchId))` ignored
  the pool, so a card could theoretically be redeemed in any pool that registered
  the same batch wallet, and nullifiers were global. The new digest is
  `keccak256(abi.encode(poolId, nullifier, batchId, address(this), block.chainid))`.
  `abi.encode` (NOT `encodePacked`) is required because `poolId` and `nullifier`
  are both dynamic — packed concatenation is no longer collision-safe with two
  dynamic fields. Storage is now `mapping(string => mapping(bytes32 => bool))
  usedNullifiers` keyed `[poolId][messageHash]`.
- **#6 — chain + contract binding.** Covered by `address(this)` + `block.chainid`
  in the digest: a card is only valid for the specific survey-store deployment on
  the specific chain it was printed for. A card signed for a deployment on base
  cannot be replayed on the same deployment of another chain.
- **#7 — reject a zero-address SMC owner.** In `registerInPool`, after
  `poolWallet = ISMC(msg.sender).owner()`, the contract now reverts
  `InvalidMemberAddress()` when `poolWallet == address(0)`, BEFORE writing
  membership. Because the tx reverts, the earlier nullifier burn + cardCount
  increment are rolled back, so a malicious SMC cannot (a) write a bogus
  `poolMembers[poolId][address(0)] = true` entry, nor (b) consume a real card.

## ABI / breaking changes

- `isNullifierUsed(string poolId, string nullifier, address batchId)` — the
  external read gains a `string poolId` parameter.
- `registerInPool` — unchanged external signature; behaviour now validates the
  new per-pool/contract/chain-bound digest.
- New custom error `InvalidMemberAddress()` added to the ABI.
- All frontend/shared callers of the read + the signing API were updated
  (grep-verified — no stale 2-arg `signCardMessage` or 2-arg `isNullifierUsed`
  callers remain in source).

## Off-chain encoding (byte-identical, single source of truth)

- `shared/src/shared/invites/encoding.ts` — rewritten around
  `CardMessageContext { poolId, storeAddress, chainId: bigint }`. New
  `cardMessageHash(context, nullifier, batchId)` returns
  `keccak256(encodeAbiParameters(parseAbiParameters('string,string,address,address,uint256'), [poolId, nullifier, batchId, storeAddress, chainId]))`
  — identical to the on-chain `abi.encode` in the contract. `signCardMessage`
  now takes the context.
- `shared/src/shared/invites/card.factory.ts` / `types.ts` — `CardData` gains
  `poolId?`; `parseCardURL` recovers `surveyOwner` only when given a context
  (without it the digest cannot be reconstructed, so owner recovery is skipped);
  `Card.isUsed` reads `isNullifierUsed([poolId, nullifier, batchId])`.
- `frontend-organiser/src/factories/invitation.factory.ts` —
  `generateCardSecrets(batchAccount, batch, storeAddress, chainId)` signs cards
  bound to the batch's pool; `survey.factory.ts` passes
  `(surveyStore.address, BigInt(base.id))`.
- The seam is pinned both ways: the contracts seam computes the digest from the
  deployed contract's `address(this)` + `block.chainid` and verifies a card
  signed by the shared off-chain encoder succeeds in `registerInPool`
  (`encoding.seam.test.ts`, on-chain oracle round-trip).

## Tests

- `contracts/test/encoding.seam.test.ts` — recomputed the regression canary
  digest with the new bindings and pinned the `abi.encode` form, per-pool /
  per-contract / per-chain scoping, the EIP-191 ethSigned wrapper, the
  recover round-trip, the on-chain `registerInPool` oracle path, and
  wrong-signer rejection.
- `contracts/test/S3ntimentSurveyStore.test.ts` — every `signCardMessage` /
  `isNullifierUsed` call site updated to the new context/ABI, plus new
  regressions:
  - (a) **cross-pool redemption fails** — a card signed for pool A cannot be
    redeemed in pool B (`InvalidSignature`), and the intended pool-A redemption
    still succeeds afterwards.
  - (b) **per-pool nullifier independence** — the same `(nullifier, batchId)`
    burned in pool A is still redeemable in pool B (same batch registered in both).
  - (c) **zero-address owner** — a malicious SMC returning `address(0)` reverts
    `InvalidMemberAddress()`, and the nullifier is NOT burned (rollback).
  - (d) the pre-existing happy path and error matrix stay green.
- Frontend/shared suites updated to the new API + context:
  `shared` (86), `frontend-organiser` (28), `frontend-respondents` (107).
  Respondent real code (`router.gates.ts`) now resolves the pool via
  `fetchSurvey` before the per-pool `isUsed` check; `auth-ctrlr.ts` already
  resolves the pool before `register`.
- `contracts/deployments/base/S3ntimentSurveyStore.json` ABI refreshed to match
  the compiled source (`pnpm check:abi` green) so frontends import the updated
  `isNullifierUsed` signature.

## Gates

- `cd contracts && pnpm exec hardhat test` — **50 passing** (baseline was 46;
  +4: three new regressions + one additional seam canary test).
- `pnpm --filter @s3ntiment/shared test` — 86 passing.
- `pnpm --filter @s3ntiment/frontend-organiser test` — 28 passing.
- `pnpm --filter frontend-respondents test` — 107 passing.
- `pnpm check:abi` (contracts) — green.

## Known wrinkle (respondent root gate)

A card URL carries only the surveyId (not the pool), and the respondent does not
know the pool at `parseCardURL` time (chicken-and-egg). `parseCardURL`'s context
is therefore optional: without a context it returns the card with `surveyOwner`
unset rather than failing. The respondent root gate resolves the pool via
`fetchSurvey(cardData.surveyId)` before the per-pool `isUsed` read; if the pool
cannot be resolved it proceeds conservatively (usage is re-checked later in the
flow). This is documented here as an accepted limitation of the current flow.

## Files changed (16)

- `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`
- `contracts/test/S3ntimentSurveyStore.test.ts`
- `contracts/test/encoding.seam.test.ts`
- `contracts/deployments/base/S3ntimentSurveyStore.json`
- `shared/src/shared/invites/encoding.ts`
- `shared/src/shared/invites/card.factory.ts`
- `shared/src/shared/invites/types.ts`
- `frontend-organiser/src/factories/invitation.factory.ts`
- `frontend-organiser/src/factories/invitation.factory.test.ts`
- `frontend-organiser/src/factories/survey.factory.ts`
- `frontend-organiser/src/factories/survey.factory.test.ts`
- `frontend-respondents/src/router.gates.ts`
- `frontend-respondents/src/router-entry-gates.test.ts`
- `frontend-respondents/src/card-signature.seam.test.ts`
- `frontend-respondents/src/card-url.round-trip.test.ts`
- `frontend-respondents/src/card-class.seam.test.ts`
