# S3ntiment Code Map

> Structural overview of the s3ntiment monorepo. Keep this in context every
> session as the "where everything lives" index for reasoning about code
> without perusing every path. Specs live in `brain/specs/` (SPEC-00 is the
> system contract / map of the maps); this map is the *where* index.
>
> Regenerate the tree below with `~/s3ntiment-repomix.sh map` when structure changes.

## Component index

| Component | Package | Spec(s) | Code LOC | Entry | What it is |
|---|---|---|---|---|---|
| `shared` | `@s3ntiment/shared` | SPEC-shared | 5,310 | `src/shared/index.ts` (+ `./browser`, `./node`, `./assets`, `./components`) | Shared privacy/crypto plumbing lib for both frontends + backend: EVM/viem services, Lit service + Lit Action templates (incl. per-pool owner-invocation / user-delegation / get-public-key), Nillion/SecretVaults user client, IPFS, survey/response/collection factories + aggregation queries + tally, results scoring/tabulation, invites/cards, UI assets |
| `frontend-organiser` | `@s3ntiment/frontend-organiser` | SPEC-frontend-organiser | 7,355 | `src/main.ts` (Vite, `index.html`) | Creator/organiser web app — build pools & surveys, per-pool PKP provisioning flow, invite batches (QR cards), manage respondents, view results (PKP-owned aggregation query) |
| `frontend-respondents` | `frontend-respondents` | SPEC-frontend-respondents | 2,277 | `src/main.ts` (Vite, `index.html`) | Respondent web app — scan QR card, authenticate (OPRF/WaaP), answer privately via `storeOwned` (PKP-granted delegation), completion view |
| `contracts` | `s3ntiment-contracts` | SPEC-contracts | 802 | `hardhat.config.ts` (rocketh deploy) | On-chain: `S3ntimentSurveyStore.sol` (pools, surveys, anonymous respondent registry), GreetingsRegistry, deploy scripts, deployments (unchanged by owned-collections merge) |
| `protocol` | `@s3ntiment/protocol` | SPEC-protocol | 151 | `scripts/` | Lit Protocol ops scripts — payment delegation (get-sponsored, delegate-user, fund-myself); Naga-era vestige (GAP-6) |
| `nillcc-backend` | `@s3ntiment/nillcc-backend` | SPEC-nillcc-backend | 1,232 | `src/main.ts` (Express) | Backend API — per-pool PKP + nilDB builder registration, PKP-owned collections/queries, `NillionPkpClient`, survey/pool controllers, Lit pool-keys, IPFS; serves both frontends |
| `website` | `website` | — | 88 | `index.html` + `build-css.ts` | Static landing site ("privacy by design"), scss → css build |

Total ~17.2k LOC. Specs live in `brain/specs/`; read SPEC-00 first.

## Per-component key dirs

- **shared** — `src/shared/` (`evm/`, `lit/` + `lit/actions/` templates incl. `get-public-key.ts`, `owner-invocation.ts`, `user-delegation.ts`, `nillion/` incl. `did.ts`, `delegations.ts`, `ipfs/`, `survey/` incl. `queries.ts`, `tally.ts`, `collection.factory.ts`, `response.factory.ts`, `invites/`, `results/`, `helpers/`), `src/browser/` (`evm/waap.service.ts`, `oprf/`, `graphs/`), `src/node/` (`lit.key-storage.ts`, `lit.pool-keys.ts`), `src/assets/` (fonts, icons, CSS-in-TS `styles/`, tokens, wasm), `src/components/`.
- **frontend-organiser** — `src/components/` (`survey-forms/`, `survey-results/`, editors/lists), `src/controllers/` (`new.ctrlr.ts.ts`, `survey.ctrlr.ts`, …), `src/factories/` (auth/invitation/pool/survey), `src/services/services.ts` (ServiceContainer), `src/state/` (stores), `src/utils/`.
- **frontend-respondents** — `src/controllers/` (auth/survey/completed/used-card…), `src/components/`, `src/state/` (incl. `pool.store.ts`), `lit-actions/decrypt-signature.js`, `src/auth.factory.ts`, `src/ux.factory.ts`.
- **contracts** — `src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, `deploy/`, `deployments/{base,sepolia}/`, `rocketh/`, `scripts/`, `test/`.
- **protocol** — `scripts/` (`get-sponsored.ts`, `delegate-user.ts`, `fund-myself.ts`).
- **nillcc-backend** — `src/services/` (`nildb.pkp.service.ts`, `nildb.builder.service.ts`, `nillai.service.ts`), `src/survey.ctrlr.ts`, `src/pool.ctrlr.ts`, `src/key.management.ts`, `src/contract.factory.ts`, `Dockerfile`/`docker-compose.yaml`.
- **website** — `scss/` (source), `assets/styles/` (generated css — excluded from dumps), `index.html`, `build-css.ts`.

## Repomix usage (economical tiers)

Wrapper: `~/s3ntiment-repomix.sh`. Dumps → `/tmp` (ephemeral). Comments always kept.

- **Tier-0 `map`** — structure only, whole repo (~16KB). Always-on. → this file's tree.
- **Tier-1 `sig <comp>`** — compressed signatures + comments, one component. Prefer for reasoning about interfaces.
- **Tier-2 `full <comp> [glob]`** — full bodies, one component, optionally narrowed with `--include`. Last resort; for bug-tracing/body-reading. One component at a time.
- **`share`** — full-source dump of all code components as a single shareable Markdown file (~0.56MB / ~141k tokens / ~204 files) → `/tmp/s3ntiment-share.md`. Passes explicit component dirs (not repo-root globs) so the committed `.pnpm-store/` (1.1GB) and `branding/` are never scanned; excludes binaries (ttf/wasm/svg/odp), deployment artifacts (`contracts/deployments/`), runtime key material (`nillcc-backend/.data/`), and `.vite` cache. Use when you need to hand the codebase to someone/something else.

**Metering rules:** this map = default context; load a code dump only when a question demands it; prefer Tier-1, escalate to Tier-2 only for bodies/bug-tracing; one component per dump; narrow with include before going full; drop a dump once the question is answered.

## Structure (snapshot)

```
shared/
  src/{assets/{fonts,icons,styles,wasm},browser/{evm,graphs,oprf},components,node,shared/{evm,helpers,invites,ipfs,lit/{actions},nillion,results,survey}}/  src/index.ts
frontend-organiser/
  src/{components/{survey-forms,survey-results},controllers,factories,services,state,utils}/  src/main.ts  src/router.ts  index.html  vite.config.js
frontend-respondents/
  src/{components,controllers,state,utils}/  src/main.ts  src/router.ts  src/auth.factory.ts  lit-actions/decrypt-signature.js  index.html  vite.config.js
contracts/
  src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol  deploy/  deployments/{base,sepolia}/  rocketh/  scripts/  test/  hardhat.config.ts
protocol/
  scripts/{get-sponsored,delegate-user,fund-myself}.ts
nillcc-backend/
  src/{services,contract.factory.ts,env.ts,key.management.ts,main.ts,pool.ctrlr.ts,survey.ctrlr.ts}  Dockerfile  docker-compose.yaml
website/
  scss/  assets/styles/  index.html  build-css.ts
branding/   (asset-only: fonts, svg, odp, pdf — no code)
brain/
  code-map/  specs/  audits/  (this file + SPEC-00..SPEC-protocol + dated audit notes)
```

Full file-level tree: run `~/s3ntiment-repomix.sh map` → `/tmp/s3ntiment-structure.md`.
