/**
 * Packaged runtime-resolution gate for `s3ntiment-contracts/constants`.
 *
 * WHY: nillcc-backend starts with `node dist/main.js`. Node's ESM loader
 * cannot execute a raw `.ts` file, so the `./constants` export must point at a
 * COMPILED JS artifact (`./dist/constants.js`), not the source
 * `./src/constants.ts`. `tsc --noEmit` (type-check only), `vitest` and `tsx`
 * all transpile `.ts` and therefore MASK a broken runtime resolution. This
 * script boots plain `node` against the built export — the same resolution
 * path the packaged backend hits — and asserts the values still derive from
 * the committed deployment JSON (the single source of truth).
 *
 * It resolves the package export via Node's self-reference feature, which is
 * byte-for-byte the same resolution `node dist/main.js` performs against its
 * `s3ntiment-contracts` dependency.
 *
 * Run: `pnpm --filter s3ntiment-contracts check:constants`
 * (builds `dist/constants.js` first, then executes this check).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { S3NTIMENT_STORE, S3NTIMENT_STORE_BY_NETWORK } from 's3ntiment-contracts/constants';

const here = path.dirname(fileURLToPath(import.meta.url));

// 1) The export MUST resolve to the compiled JS in dist — never raw src .ts.
const resolved = import.meta.resolve('s3ntiment-contracts/constants');
if (!resolved.endsWith('/dist/constants.js')) {
  throw new Error(
    `s3ntiment-contracts/constants resolves to ${resolved} — expected the compiled ./dist/constants.js (a raw .ts target is not node-loadable).`,
  );
}

// 2) Values must derive from the committed deployment JSON.
const deployment = JSON.parse(
  readFileSync(
    path.join(here, '..', 'deployments', 'base', 'S3ntimentSurveyStore.json'),
    'utf8',
  ),
);

const failures = [];
if (S3NTIMENT_STORE.address !== deployment.address) {
  failures.push(`address ${S3NTIMENT_STORE.address} !== deployment ${deployment.address}`);
}
if (!Array.isArray(S3NTIMENT_STORE.abi) || S3NTIMENT_STORE.abi.length === 0) {
  failures.push('abi is empty or not an array');
} else if (S3NTIMENT_STORE.abi.length !== deployment.abi.length) {
  failures.push(`abi length ${S3NTIMENT_STORE.abi.length} !== deployment ${deployment.abi.length}`);
}
if (S3NTIMENT_STORE.chainId !== 8453) {
  failures.push(`chainId ${S3NTIMENT_STORE.chainId} !== 8453 (Base)`);
}
if (S3NTIMENT_STORE_BY_NETWORK.base.address !== deployment.address) {
  failures.push('registry base address mismatch');
}

if (failures.length > 0) {
  throw new Error('check:constants FAILED:\n  - ' + failures.join('\n  - '));
}

console.log(
  `check:constants OK — resolved ${resolved}\n` +
    `  S3NTIMENT_STORE.address=${S3NTIMENT_STORE.address}\n` +
    `  S3NTIMENT_STORE.abi.length=${S3NTIMENT_STORE.abi.length}\n` +
    `  S3NTIMENT_STORE.chainId=${S3NTIMENT_STORE.chainId} (Base)\n` +
    `  networks=${Object.keys(S3NTIMENT_STORE_BY_NETWORK).join(',')}`,
);
