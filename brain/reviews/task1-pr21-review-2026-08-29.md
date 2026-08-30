# Independent Review — PR #21 (Task 1: RFC-deferred-identity-persistence)

**Date:** 2026-08-29
**Diff reviewed:** `/home/joera/code/s3ntiment/brain/audits/task1-pr21-diff.txt` (772 lines, `git diff main...HEAD`). **Context:** RFC §5.2/§7.1/§8.2 and the 2026-08-29 explore doc. I did **not** open the implementer's worktree; I verified supporting facts (viem export, `updateSignerWithKey`, package.json, dangling-import scan, storage pattern) against the main repo only.

## (1) Verdict per contract item

### A. human-wallet flow extracted, no longer called at entry — **MET**
- `auth.factory.ts` → `humanWallet.factory.ts` (git rename, similarity 62%): retains `export const authenticate` (waap.login → signMessage → oprf.getSecp256k1 → updateSignerWithKey) and `export const hasParticipatingAccount`, with a header comment declaring it the LATER post-survey persist flow ("NOT called at the survey entry gate").
- All three production callers of `authenticate` are converted in this diff: `router.gates.ts` (`hasParticipatingAccount`/`authenticate` → `ensureBootstrapKey`), `auth-ctrlr.ts`, `used-card-ctrlr.ts` (both `authenticate` → `ensureBootstrapKey`). Grep of the whole repo (excl. worktree) confirms **no remaining importer of the renamed `./auth.factory.js`** (the only other `auth.factory` hits are `frontend-organiser`'s separate `factories/auth.factory` — out of scope). No dangling import → build cannot break on the rename.

### B. Random bootstrap leaf E (CSPRNG, no anchor/OPRF), persisted immediately, set as signer — **MET**
- `bootstrap.factory.ts`: `generatePrivateKey` imported from `viem/accounts`. I executed `import('viem/accounts')` in the package and confirmed it's a live export returning `0x` + 64 hex (66 chars). It's CSPRNG-backed (noble `randomPrivateKey` → webcrypto `getRandomValues`), matching the explore doc's recommendation. No anchor/OPRF/PRF in the path.
- `createAndPersistBootstrapKey()` writes to localStorage **at generation** via `saveBootstrapKeyToStorage` (RFC §7.1), before the signer swap — verified by test "persists the generated key even if setting the signer fails".
- `ensureBootstrapKey()` = `loadBootstrapKeyFromStorage() ?? createAndPersistBootstrapKey()` (load-or-create) → `updateSignerWithKey(key)` → `getSignerAddress()`. The signer swap goes through the smart-account service, satisfying explore concern C2 (SMC address is the registered identity).
- `storage.ts` adds `BOOTSTRAP_STORAGE_KEY = 'bootstrapE'` plus validated load (`/^0x[0-9a-fA-F]{64}$/`, malformed → null) and try/catch save — matches the existing storage.ts pattern.

### C. Entry call sites; waap.logout preserved; eager init deferred — **MET**
- `router.gates.ts` `resolveSurveyGate` is now "fetch survey → ensure E exists + persisted → `{ proceed: true }`"; membership gate removed (E is pre-registration at entry, RFC §5.2/§8). `auth-ctrlr.ts` and `used-card-ctrlr.ts` re-established via `ensureBootstrapKey`.
- `services.ts`: `await this.waap.createWallet(base)` and `await this.oprf.init()` removed from `initialize()` with an explanatory comment; `oprf`/`waap` are still constructed (cheap) and the `waap.logout()` call in `logout.ctrlr.ts` is untouched → **waap.logout preserved**.

### D. No new deps; no post-survey persist route; contract/work untouched — **MET**
- Only file in the diff is `frontend-respondents/src/…` (12 files: 2 new, 2 renames, 8 edits). No `package.json` change — `viem` is already a dependency (pinned ^2.45.0). No `router.ts`/route changes → no persist route. No contract/shared/worktree-touching files.

### E. Tests rewritten + bootstrap coverage; 3 gates green — **MET (by inspection)**
- `bootstrap.factory.test.ts` is the highlight: it uses a **real** in-memory localStorage stub (not mocked behavior) and asserts the actual contract — persist-on-generate, reuse-without-regenerate, malformed→regenerate, persist-before-signer-failure, and the storage helpers. This is behavior asserted, not mocked away.
- Renamed `humanWallet.factory.test.ts` (authenticate/hasParticipatingAccount still pinned), rewritten `auth-ctrlr.test.ts`, `used-card-ctrlr.test.ts`, `router-entry-gates.test.ts` (no longer reference `hasParticipatingAccount`/`authenticate`; assert `ensureBootstrapKey` called once / not called on the missing-surveyId early return / rejection propagation).
- I traced every test against the new code paths and the mock topology (narrow `viem/accounts` mock; `services`/`storage` type-imports elided so no heavy shared graph loads in node); I found no failure mode. **Caveat:** I could not execute the suite (worktree off-limits, main repo is pre-PR) — gate-green is assessed statically.

## (2) Issues

### BLOCKING
**None.** Runtime flow is wired correctly: persistence is actually connected (storage helpers → factory → called from all three gates), `generatePrivateKey` import/signature verified correct, and no gate or build regression found.

### NON-BLOCKING

**N1 — Raw private key in localStorage (security).** `bootstrapE` holds the unencrypted raw 32-byte private key (storage.ts). This is **by design** per RFC §8.2 ("transient bootstrap `E`" is explicitly permitted in app-local storage) and is required by §7.1 (survive tab close), and E is deliberately not the anchor. Still worth recording: it is XSS/device-readable, has no expiry, and nothing in this PR discards E — rotation E→S is deferred to the persist task. *Why it matters:* acceptable now, but the persist task **must** wipe `bootstrapE` after re-derivation, and the raw key should never be logged/echoed. *Fix:* none for Task 1; file it for the persist task + consider a comment near the key.

**N2 — `used-card-ctrlr` now navigates unconditionally; membership check dropped.** Old code: `authenticate` → "You did not register for this survey" alert on non-participant. New code: `ensureBootstrapKey` → unconditional `router.navigate`. The matching negative test was deleted. *Why it matters:* a used-card user on a new device (no persisted E) gets a fresh, unregistered E and reaches the survey UI with no pool membership — exactly the §7.1 abandonment reality, but the "sign in" affordance no longer verifies anything. *Fix:* acceptable under the contract as written ("gate means ensure E exists + persisted"); revisit when the persist route lands (used-card is the natural entry for returning anchors).

**N3 — `auth-ctrlr` always registers (no participant shortcut).** Old flow skipped `card.register` and navigated when already a participant. New flow always `card.register(...)`. *Why it matters:* for a genuinely used card this route isn't reached (root gate routes to used-card), so the always-register path is correct for the unregistered-E entry — but a re-registration of an already-registered E touches RFC Q2 (idempotency) semantics, which are explicitly open. *Fix:* none for Task 1; confirm Q2 before the persist task relies on re-registration.

**N4 — Persistence is best-effort only.** `saveBootstrapKeyToStorage` swallows `setItem` failures with `console.warn`; if storage is blocked (private mode/full), `ensureBootstrapKey` still proceeds to the signer swap, and the membership would be orphaned on tab close — the exact §7.1 failure this is meant to prevent. This mirrors the existing storage.ts pattern, and the RFC's mitigation is the anchor path, so it's defensible. *Fix (optional):* have `createAndPersistBootstrapKey`/`ensureBootstrapKey` surface persistence failure (return/throw) and add a test for the setItem-throws path.

**N5 — Style nit (non-runtime).** `bootstrap.factory.ts` imports `IServices` from `'./services'` (no `.js`) while `./state/storage.js` has the extension. Harmless — esbuild elides the type-only import (no runtime resolution), matching the pre-existing pattern in `auth.factory.ts` — but inconsistent with the repo's explicit-`.js` ESM convention.

## (3) Recommendation

**READY TO MERGE** — all five contract items are met with supporting evidence, the runtime path (persist → load-or-create → signer swap → all three gates) is genuinely wired and directly tested, and the remaining items (N1–N5) are deliberate design consequences or future-task follow-ups, none of which block this PR.
