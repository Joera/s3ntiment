# Organiser Frontend — Invite/Card Test Tranche B (2026-08-28)

**Status:** implement — landed
**Branch:** `deepseek/organiser-invite-tests`
**Base state:** `main` `f23d0dfd3` (includes respondent invitation/card tests from PR #11)
**Mission:** mirror the `frontend-respondents` vitest wiring into `@s3ntiment/frontend-organiser`
and pin the producer half of the shared card-encoding handshake.

---

## Summary

Wired vitest into `frontend-organiser` (which previously had **no** test runner — the `test`
script just printed "Error: no test specified && exit 1"), then landed a first tranche of tests
covering the organiser's card-generation surface (`invitation.factory`) plus the trivial `utils`
helpers, and a bonus `survey.factory` suite. The centrepiece is a **producer→consumer round-trip
seam test**: real `generateCardSecrets` output fed into the real shared `parseCardURL`, with the
recovered `surveyOwner === batch.id` — the exact equality on-chain `registerInPool` and the
respondent auth flow enforce.

**Results:** `28 passed` across 4 files (below). `build` stays green. No production source changed.

| File | Count |
|---|---|
| `src/factories/invitation.factory.test.ts` | 14 |
| `src/factories/survey.factory.test.ts` | 3 |
| `src/utils/hex.test.ts` | 4 |
| `src/utils/regex.test.ts` | 7 |
| **Total** | **28** |

---

## Infra (mirrors respondents verbatim)

- **`package.json`** — added `"vitest": "^4.1.11"` to devDeps; `test` script → `"vitest run"`.
- **`vitest.config.ts`** (new) — `environment: 'node'` (no jsdom), `include: ['src/**/*.test.ts']`,
  `setupFiles: ['./test/setup.ts']`, `reporters: ['default']`, `resolve.alias` mapping
  `react`/`react-dom` → `src/empty-module.ts`, **plus** a `define` for
  `import.meta.env.VITE_FRONTEND_DEV` (see R2 below).
- **`test/setup.ts`** (new) — copied respondent stub verbatim: in-memory `localStorage`,
  `window = { location: { href: '' } }`, `document = { querySelector: () => null }`, `alert`.

### R2 — `import.meta.env` BASEURL
`invitation.factory.ts` reads
`BASEURL = import.meta.env.VITE_PROD == "true" ? VITE_FRONTEND_PROD : VITE_FRONTEND_DEV` at
module scope. Under vitest `import.meta.env` otherwise resolves to `{}` → `BASEURL` undefined →
malformed URLs. Per the exploration's recommendation we used the **define-route** (no production
refactor): `define: { 'import.meta.env.VITE_FRONTEND_DEV': 'https://organiser.local/' }`.
`VITE_PROD` is left unset so the else-branch is taken deterministically. The URL host is irrelevant
to `parseCardURL` (it only reads the query string).

### R3 — dependency graph / waap-OPRF-Lit leak
- `invitation.factory.test.ts` **type-imports `IServices` only**; the production module's own
  `import { IServices } from '../services/services'` is type-only, so we neutralize it with
  `vi.mock('../services/services', () => ({}))` — nothing from `services.ts` / `auth.factory.ts`
  (waap/OPRF/Lit) is ever loaded at module scope.
- `@s3ntiment/shared`'s package `exports` resolve to **unbuilt `dist`** in a fresh checkout. The
  only runtime value `invitation.factory` needs from it is the **real `signCardMessage`** (used
  inside `generateCardSecrets`), so we re-export it via
  `vi.mock('@s3ntiment/shared', async () => { const enc = await import('../../../shared/src/shared/invites/encoding.js'); return { signCardMessage: enc.signCardMessage }; })`
  — the **relative-source-path precedent** from the respondents. The shared `.ts` source is used,
  never a stub and never a possibly-stale dist.

### R4 / R5
- Browser globals used (`crypto.getRandomValues`, `randomUUID`, `btoa`, `Blob`, `URL`) all exist
  in Node ≥18 — no jsdom.
- Shared consumer (`parseCardURL`) + encoding imported by direct relative source path
  (`../../../shared/src/shared/invites/...`), matching the respondent `card-signature.seam` and
  `card-url.round-trip` precedent.

---

## Test files

### `src/factories/invitation.factory.test.ts` (14)
- **`createBatchWallet` (4):** returns a valid `0x` 40-hex address + an in-memory account object
  (`batchId === batchAccount.address`); deterministic batchId for a fixed mocked
  `services.safe.signMessage`; private key never serialized (asserts the derived
  `keccak256(toBytes(sig))` secret hex is absent from the output, and the public surface is exactly
  `{ batchId, batchAccount }`); different signatures → different batchIds (proving keccak
  derivation).
- **`generateCardSecrets` (6):** returns `batch.amount` cards; unique base64url-shaped nullifiers
  (`/^[A-Za-z0-9_-]{22}$/` — 16 bytes → 22 chars after padding strip); each `card.url` matches the
  frozen shape `${BASEURL}?n=…&b=…&sig=…&s=…`; every card has `svgString` and `QRCode.toString`
  is called with the url; **CROWN JEWEL** — every produced `card.url` round-trips through the real
  shared `parseCardURL` with `surveyOwner === batch.id` + nullifier/surveyId/batchId recovery;
  nullifiers contain no URL-special chars (base64url, padding stripped).
- **`createCsvFile` (3):** quoted + newline-joined CSV string in a `text/csv` Blob
  (`"a","b"`), `saveAs` called with `` `${filename}.csv` ``, values with commas/quotes still quoted.
- **`createZipFile` (1):** `saveAs` called with `s3ntiment-qr-codes-<surveyId>.zip` and a non-empty
  Blob (real JSZip).

### `src/factories/survey.factory.test.ts` (3) — OPTIONAL, included
The module's `s3ntiment-contracts … S3ntimentSurveyStore.json` `assert { type: 'json' }` import and
the `permissionless/accounts` import loaded cleanly under the node runner (no heavy mocking
needed), so per the mission allowance this bonus suite was included:
- **`createBatch` (2):** with `createBatchWallet`/`generateCardSecrets`/`uploadToPinata` mocked —
  asserts `batch.id = getAddress(batchId)`, `batch.survey`/`batch.pool` set, `generateCardSecrets`
  called with the derived `batchAccount` + batch, and cards `uploadToPinata`'d.
- **`registerBatch` (1):** `services.account.write` mock → `('registerBatch', [batch.pool, batch.id], { waitForReceipt: true })`.

> Note: the "dropped if it drags the graph" fallback did **not** trigger — survey.factory imported
> cleanly and the suite is included.

### `src/utils/hex.test.ts` (4)
`ensureHex`: valid plain hex → `0x…`; normalizes existing `0x`/`0X` prefix + lowercases mixed case;
throws on empty; throws on non-hex/malformed.

### `src/utils/regex.test.ts` (7)
`isCid` v0+v1 accept/reject; `isDid` accept/reject; `isDidKey` accept/reject.

---

## Acceptance gates (all hold)

```
pnpm --filter @s3ntiment/frontend-organiser test   # 4 files, 28 passed
pnpm --filter @s3ntiment/frontend-organiser build  # ✓ built in ~1m16s (existing chunk-size warning only)
```

Other packages unaffected: `frontend-respondents` suite still `49 passed (7 files)`. The `pnpm
install` ran `shared`'s `prepublishOnly` (tsc) building `shared/dist`, but `shared/dist` is
gitignored and no shared source changed.

- **No production source changed** (define-route for BASEURL; `services.ts` neutralized via mock).
- **No jsdom, no network, no live chain** — signatures are produced/recovered offline via the real
  shared `signCardMessage`/`parseCardURL`.
- Non-vacuous assertions throughout (exact URL equality, on-chain equality, secret-absence).

---

## Gate commands (exact)

```
cd <worktree>/frontend-organiser
pnpm exec vitest run           # or: pnpm test
#  Test Files  4 passed (4)
#  Tests       28 passed (28)

pnpm build                     # ✓ built
```
