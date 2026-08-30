# REVIEW — PR #15 (deepseek/nilcc-builder-branches @ a69fd26dc) — Bucket 1.2

**Reviewer:** independent review session (fresh; prior reviewer hung/terminated).
**Scope:** NilDBBuilderService branch coverage against the bucket 1.2 acceptance
contract.
**Method:** read the neutral diff bundle
(`brain/reviews/nilcc-builder-branches.diff`, 3 files), the committed audit report
(`brain/audits/nilcc-builder-branches-2026-08-28.md`), and the real production
source in the main checkout. Independently installed nillcc-backend deps and
re-ran both gates. Did NOT read any implementer worktree.

The diff touches exactly 3 files: the audit doc, `nildb.builder.service.test.ts`
(test), and `nildb.builder.service.ts` (the two sanctioned production edits).
No other scope.

---

## Per-item verdict

### 1. Coverage of the previously-uncovered real logic — PASS
All four required areas are covered, and the assertions are non-vacuous:
- **submitResponseForUser idempotent replace** (+3): replace flow (exists→2 ids
  →deleteData per id with `{collection, filter:{_id}}`→createStandardData with
  `{collection, data:[userData]}`), first-insert branch (exists false→no delete),
  and rethrow-on-createStandardData-failure. All verified against the real method
  body (`exists()` returns `data.map(r=>r._id)` or `false`; delete loop; rethrow).
- **delegateCollectionToPkp** (+1): asserts a *real signed NUC delegation* — 3-part
  token, payload `cmd=/nil/db/{coll}/data/create`, `aud`=PKP DID, `sub`=builder DID,
  future `exp`. This exercised genuine NUC local signing (no network) and passed;
  the field names (cmd/aud/sub), 3-part envelope, and payload position all match
  the lib's actual envelope.
- **getOwnerReadDelegation** (+1): pins the real (current) reject behavior — see
  flagged-bug item.
- **findSurveyResults** (+2): real-tally assertion + reject→`{result:false}`.
  The tally is grounded in the **real** shared `tallyResults` leaf (`shared/
  src/shared/results/tabulate.ts`): the whole-barrel mock's `tallyResults` now
  delegates to the leaf, and the assertion cross-checks against the same leaf
  imported directly by relative source path. I independently confirmed the leaf's
  radio branch produces `counts {a:2,b:1}`, `total = rawResults.length = 3` for the
  sample rows — the asserted values are exactly what the real algorithm yields,
  so the assertion is meaningful, not vacuous. The suite was 7→14 cases.

### 2. Exactly two sanctioned, behavior-preserving production changes — PASS
Only `nildb.builder.service.ts` changed in production, with precisely the two
sanctioned tweaks:
- (a) optional ctor-injected `builderClient` behind an `if (builderClient)` guard —
  `new NilDBBuilderService()` behaves identically (client stays unset, built later
  by `initBuilder()`); no production caller changed.
- (b) `findResultsDelay: number = 5000` field used in place of the hardcoded
  `setTimeout(r, 5000)` — default unchanged, byte-for-byte equivalent in prod.
No other production change. No scope creep, no unrelated refactor.

### 3. Zero-network, node env — PASS
`vitest.config.ts` sets `environment: 'node'`; `test/setup.ts` only sets benign
env vars (no network, no real creds). Tests construct the service against a real
local signer (`getDid()` local derivation) and inject fake builder clients; the
NUC delegation tests perform local signing only. Suite ran in ~1.4s total with no
hangs, fetch, or live chain/Nillion/Lit calls.

### 4. Gates: vitest green + tsc build green — PASS (independently re-run)
Independently ran from a fresh install:
- `pnpm vitest run` → `4 passed (4) Test Files`, `35 passed (35) Tests`, exit 0
  (matches the implementer's 28 pre-existing + 7 new claim exactly).
- `pnpm build` (tsc) → exit 0, green.
- `tsconfig.json` excludes `src/**/*.test.ts` from the build, so the test files do
  not break tsc; no production behavior touched to keep it green. Verified.

### 5. Test-only discipline — PASS
Diff is limited to the test file + the two sanctioned production edits + the audit
doc (a non-code artifact). No unrelated refactors; existing tests untouched
(28 pre-existing passed with zero regressions).

---

## Flagged latent bug — relayed concern ACCURATE (assessed against repo source + installed dep)

`getOwnerReadDelegation` uses `.expiresIn(365 * 24 * 3600_000)` ≈ **365 days**.
I confirmed from the installed `@nillion/nuc@2.x`
(`node_modules/@nillion/nuc/dist/lib.mjs`):
- `FOUR_WEEKS_MS = 672 * ONE_HOUR_MS = 28 days`; `DEFAULT_MAX_LIFETIME_MS =
  FOUR_WEEKS_MS`.
- `sign()` computes `maxExpiry = Date.now() + this._maxLifetimeMs` (28 days) and
  throws `Expiration of … exceeds the maximum lifetime` when the requested expiry
  exceeds it.

Since 365 days ≫ 28 days, `getOwnerReadDelegation` **throws every time** and can
never produce a delegation as written — the implementer's flagged finding is
accurate, including the "~28 days" figure (28 days is exactly NUC's default max).
The test pins this real behavior (`rejects.toThrow(/maximum lifetime/)`), the suite
passes, and the comment documents it. Given the contract forbids any third
production change, flagging-not-fixing is the correct call; the choice to pin the
actual buggy behavior is appropriate and makes the gap visible and
regression-guarded.

Suggest a follow-up (outside this tranche): change `getOwnerReadDelegation` to
`expiresIn(28 * 24 * 3600_000)` (matching `delegateCollectionToPkp`) so the method
produces a delegation, and flip the test to assert success.

---

## Nits (non-blocking)
- `delegateCollectionToPkp` retains the pre-existing misleading comment `// 1000
  years` while using 28 days — pre-existing, not introduced here; worth cleaning up
  in a follow-up.
- `getOwnerReadDelegation`'s test pins broken behavior rather than intended
  behavior (unavoidable under the no-third-change rule; fine as-is).

---

## Overall verdict: **APPROVE**

All five contract items pass with independent gate verification (35/35 vitest,
tsc green, node env, zero-network), exactly two sanctioned behavior-preserving
production edits, no scope creep, and a non-vacuous, real-semantics tally
assertion. The flagged latent bug is confirmed accurate against both the repo
source and the installed NUC dependency and is correctly left out of scope.
