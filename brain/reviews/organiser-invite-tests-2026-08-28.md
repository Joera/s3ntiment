# Review — PR #14: frontend-organiser invite/card test tranche (B) + vitest infra

**Verdict:** ✅ APPROVE (no blockers)
**Reviewer:** fresh independent builder session (diff + contract only); hand-traced every assertion against real source (deps not installed in reviewer checkout — but orchestrator independently ran the gates)
**Branch/commit:** deepseek/organiser-invite-tests @ 929f65242
**Test count (orchestrator-verified):** 28/28 vitest across 4 files; build green (1m16s)

## What it adds
- Wires vitest into @s3ntiment/frontend-organiser (had NO runner; broken test script), mirroring frontend-respondents verbatim: node env, vitest.config.ts with react alias + define VITE_FRONTEND_DEV (R2), test/setup.ts, test script -> vitest run.
- invitation.factory.test.ts (14): createBatchWallet (deterministic 0x batchId, account never persisted), generateCardSecrets (amount cards, unique base64url nullifiers, URL shape, svgString), createCsvFile, createZipFile. CROWN JEWEL: real generateCardSecrets -> real shared parseCardURL round-trip, recovered surveyOwner === batch.id.
- survey.factory.test.ts (3, optional): createBatch/registerBatch with mocks.
- utils/hex.test.ts (4) + utils/regex.test.ts (7).

## Per-item (all PASS)
(1) INFRA mirrors respondents — PASS
(a) Crown-jewel round-trip REAL (real producer, real consumer, same on-chain bytes) — PASS
(b) vi.mock('@s3ntiment/shared') re-exports REAL signCardMessage from relative shared .ts source — PASS
(c) R3 waived: no waap/OPRF/Lit module loads at test runtime — PASS
(d) utils tests match real hex/regex behavior, non-vacuous — PASS
(e) no production source changed — PASS
Count 28/4 confirmed — PASS

## Nits (non-blocking)
- None material. Reviewer flagged it could not re-run the suite (no deps) and verified statically; orchestrator re-ran gates green independently.

**Status:** ready to merge (orchestrator does not merge).
