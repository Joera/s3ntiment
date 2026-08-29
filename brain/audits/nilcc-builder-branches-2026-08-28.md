# NilDBBuilderService branch coverage — Bucket 1.2 (2026-08-28)

**Branch:** `deepseek/nilcc-builder-branches` (worktree) — based on `main` `b5e622671`.
**Scope:** cover the previously-zero-coverage real logic in
`@s3ntiment/nillcc-backend`'s `NilDBBuilderService` (`nillcc-backend/src/services/nildb.builder.service.ts`).
**Package gates:** `pnpm vitest run` (all tests) and `pnpm --filter @s3ntiment/nillcc-backend build` (tsc).

---

## 1. What was added (test files, per-file case counts)

Single test file extended (the existing builder suite from PR #8 was not replaced,
only grown):

| File | Cases (before → after) |
|---|---|
| `nillcc-backend/src/services/nildb.builder.service.test.ts` | 7 → **14** (+7) |

New `describe` blocks and their cases (all zero-network, `node` env):

- **`NilDBBuilderService.submitResponseForUser (idempotent replace)`** — +3
  1. Replace flow: `exists()` returns two doc ids → `deleteData` called once per id
     (each with `{ collection, filter: { _id } }`), then `createStandardData` called
     with `{ collection, data: [userData] }` and its result returned.
  2. No-existing-docs branch: `exists()` → `false` → **no** `deleteData`, only
     `createStandardData` (first-insert path).
  3. Failure path: `createStandardData` rejects → error is logged and rethrown
     (asserts `rejects.toThrow`).
- **`NilDBBuilderService delegation issuance`** — +2
  4. `delegateCollectionToPkp(collectionId, pkpDid)` emits a real signed NUC
     delegation: 3-part token whose payload carries `cmd=/nil/db/{collectionId}/data/create`,
     `aud` = the PKP DID, `sub` = builder DID, and a future `exp` (28-day lifetime).
  5. `getOwnerReadDelegation(surveyOwnerDid, surveyId)` — **pins real current
     behavior**: it rejects with `Expiration … exceeds the maximum lifetime`
     (the hardcoded 365-day `expiresIn` exceeds NUC's max lifetime of ~28 days).
     See §3 for the latent-bug note.
- **`NilDBBuilderService.findSurveyResults (real tally)`** — +2
  6. Real tally: `findResultsDelay=0` (injected), `findData` returns raw rows, and
     the output equals the **directly-imported leaf** `tallyResults(rawData, groups)`
     (counts `{a:2,b:1}`, `total:3`).
  7. `findData` rejects → returns `{ result: false }`.

Suite totals: **35 passing tests** across 4 files (28 pre-existing → zero
regressions; builder file 7 → 14).

---

## 2. Source changes (both behavior-preserving, both pre-sanctioned by the tranche)

File: `nillcc-backend/src/services/nildb.builder.service.ts`.

### (a) Optional constructor-injected builder client
```ts
constructor(builderClient?: any) {
    this.builderKey = config.BUILDER_KEY;
    this.builderSigner = Signer.fromPrivateKey(this.builderKey);
    if (builderClient) {
        this.builderClient = builderClient;
    }
}
```
- **Justification:** Bank of exact verification — the class previously took **no**
  ctor arg and left `builderClient` unset until `initBuilder()` built it. Injecting
  a client only when provided (the `if (builderClient)` guard) means a
  `new NilDBBuilderService()` with no arg behaves identically to before:
  `builderClient` stays unset and is still built later by `initBuilder()`. No
  production caller changes.

### (b) Parameterized `findSurveyResults` settle delay
```ts
findResultsDelay: number = 5000;             // new field
...
await new Promise(r => setTimeout(r, this.findResultsDelay));  // was setTimeout(r, 5000)
```
- **Justification:** the hardcoded 5s delay existed only to let NilDB catch up
  between writes and the results read — pure settle/backoff, no result-affecting
  logic. Default `5000` reproduces the original exactly, so production behavior is
  byte-for-byte unchanged; tests set `findResultsDelay = 0` to skip the wait.

**No other production code was changed.** (getBuilderProfile / initBuilder are thin
wrappers and were deliberately left untested per the low-value note; see also §3.)

### Barrel-mock handling for the tally assertion
The existing test file mocked the whole `@s3ntiment/shared` barrel with an identity
`tallyResults`. To exercise the **real** tally algorithm through `findSurveyResults`
without the unbuilt barrel, the mock's `tallyResults` now delegates to the shared
leaf module imported directly by relative source path
(`../../../shared/src/shared/results/tabulate.js`), and the assertion cross-checks
against the same leaf imported directly in the test. This is the seam-test
leaf-import discipline, per the tranche contract; the whole-barrel mock is no longer
the source of the tally assertion.

---

## 3. Latent bug discovered (out of scope — flagged, not fixed)

`getOwnerReadDelegation` uses `.expiresIn(365 * 24 * 3600_000)` (1 year), but NUC's
`DelegationBuilder.sign` enforces a **maximum delegation lifetime of ~28 days** and
throws `"Expiration ... exceeds the maximum lifetime"`. So this method can never
produce a delegation as written — any real caller hits the throw. The test pins
this real behavior (`rejects.toThrow(/maximum lifetime/)`) so the gap is visible and
regression-guarded. Fixing it (e.g. `expiresIn(28 * 24 * 3600_000)` like
`delegateCollectionToPkp`) is **out of scope** for this tranche per the contract's
"only the two sanctioned source changes" rule; noted here for a future decision.

---

## 4. Gate results (commands, run from repo root / package)

```
# Package test suite — ALL tests pass, no regressions (35 = 28 existing + 7 new)
cd nillcc-backend && pnpm vitest run
#   Test Files  4 passed (4)
#   Tests       35 passed (35)

# TypeScript build — green
pnpm --filter @s3ntiment/nillcc-backend build   # tsc, exit 0
#   (tsconfig already excludes src/**/*.test.ts from the build)
```

---

## 5. Deliverable

PR opened for `deepseek/nilcc-builder-branches` (not merged). This report is
committed to the worktree.
