# SPEC-protocol — `@s3ntiment/protocol`

## What it is

A small (~150 LOC) collection of standalone Lit Protocol payment-delegation scripts:
`get-sponsored.ts` (create a payment delegation auth sig so a sponsor pays for a user's Lit
requests), `delegate-user.ts` (set spending restrictions + batch-delegate payments to a user
address), `fund-myself.ts` (deposit LIT into the payment manager). Run via `pnpm run sponsor` /
direct `tsx` invocation, not imported by any other package.

## Entry points

`scripts/*.ts`, run standalone via `tsx`. No exports consumed elsewhere in the monorepo (grep of
other packages' imports shows no `@s3ntiment/protocol` references in this source share).

## Status: vestigial (GAP-6 resolved)

These scripts target **Naga** (`nagaTest`/`nagaDev`) via `@lit-protocol/lit-client` and the SDK's
payment-manager API — capacity-credit style payment delegation, `createPaymentDelegationAuthSig`,
spending restrictions per user address.

Naga is **deprecated** (sunset 30 days after Chipotle reached production; see DR-L1 in SPEC-shared).
Chipotle replaced capacity-credit delegation with account-level billing via API key — which is what
`LitService` does. So this package is not a parallel design or a second mode: it is **leftover
tooling from the pre-Chipotle era**.

What was Q1/GAP-6 is therefore closed. Action: delete the package, or move it under an explicitly
labelled `archive/` so nobody mistakes it for the current payment path and tries to "reconcile" the
two integrations. If anything here is still run manually, that fact needs recording before deletion —
but nothing in the monorepo imports `@s3ntiment/protocol`.

## Gaps / open questions

- GAP-4 (SPEC-00): `fund-myself.ts` has a hardcoded private key literal rather than reading from env.
  Confirm it's a disposable testnet key, then rotate/remove — and note that deleting the package
  closes this gap too.