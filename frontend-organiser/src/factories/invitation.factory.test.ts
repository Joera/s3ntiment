import { describe, it, expect, vi, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, keccak256, toBytes } from 'viem';

// --- Mocks (hoisted so vi.mock factories can reference them) ---
const mocks = vi.hoisted(() => ({
  saveAs: vi.fn(),
  qrToString: vi.fn(),
}));

// QRCode default export (invitation.factory imports `import QRCode from 'qrcode'`).
vi.mock('qrcode', () => ({ default: { toString: mocks.qrToString } }));
// file-saver named export saveAs.
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));

// R3: do NOT let services.ts / auth.factory.ts / the heavy waap-OPRF-Lit graph
// load at module scope. invitation.factory imports `IServices` from
// ../services/services ONLY as a type — at runtime it needs nothing from that
// module, so we neutralize it with an empty mock (type-only import is erased).
vi.mock('../services/services', () => ({}));

// The one runtime value invitation.factory needs from @s3ntiment/shared is the
// REAL `signCardMessage` (used inside generateCardSecrets). Its package exports
// resolve to a possibly-unbuilt dist, so we re-export the real shared .ts
// source by DIRECT RELATIVE SOURCE PATH (the respondent precedent) — keeping the
// producer half of the handshake on the same on-chain bytes, never a stub.
vi.mock('@s3ntiment/shared', async () => {
  const enc = await import('../../../shared/src/shared/invites/encoding.js');
  return { signCardMessage: enc.signCardMessage };
});

// --- Real shared consumer (crown-jewel round-trip), by relative source path ---
import { parseCardURL } from '../../../shared/src/shared/invites/card.factory.js';
import type { CardData } from '../../../shared/src/shared/invites/types.js';

import {
  createBatchWallet,
  generateCardSecrets,
  createCsvFile,
  createZipFile,
} from './invitation.factory';
import type { Batch } from '@s3ntiment/shared';

// Deterministic batch identity — doubles as the signer for generateCardSecrets.
const BATCH_PK =
  '0x00000000000000000000000000000000000000000000000000000000000000aa';
const batchOwner = privateKeyToAccount(BATCH_PK);

// Mirrors vitest.config.ts `define`: import.meta.env.VITE_FRONTEND_DEV.
const BASEURL = 'https://organiser.local/';

// card-v2 context the producer signs cards with (pool/contract/chain bound).
// Must mirror the on-chain digest (address(this), block.chainid); the tests use
// an arbitrary store address + base chain id.
const STORE_ADDRESS = `0x${'11'.repeat(20)}`;
const CHAIN_ID = 8453n;

// Mirrors generateRandomNullifier(): 16 random bytes -> base64url, no padding.
function generatedNullifier(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: batchOwner.address,
    survey: 'survey-roundtrip',
    pool: '0x0000000000000000000000000000000000000000000000000000000000000100',
    amount: 5,
    medium: 'zip-file',
    cards: [],
    ...overrides,
  } as Batch;
}

describe('invitation.factory — createBatchWallet', () => {
  beforeEach(() => {
    mocks.qrToString.mockImplementation(() => Promise.resolve('<svg/>'));
  });

  it('returns a 0x address batchId and an in-memory batchAccount shape', async () => {
    const services: any = {
      safe: { signMessage: vi.fn().mockResolvedValue('0x' + '11'.repeat(32)) },
    };
    const { batchId, batchAccount } = await createBatchWallet(services);
    // batchId is a valid 40-hex-char EOA address.
    expect(batchId).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // batchAccount is the derived signing account (an object, not a secret key
    // string); it is held in memory only.
    expect(batchAccount).toBeTruthy();
    expect(typeof batchAccount).toBe('object');
    expect(batchAccount.address).toBe(getAddress(batchId));
    // The derived account's address == the reported batchId.
    expect(batchId).toBe(batchAccount.address);
  });

  it('derives a deterministic batchId from a fixed mocked signature', async () => {
    const services: any = {
      safe: { signMessage: vi.fn().mockResolvedValue('0x' + '22'.repeat(32)) },
    };
    const a = await createBatchWallet(services);
    const b = await createBatchWallet(services);
    // Same mocked signature -> same seed-independent batchId (deterministic).
    expect(a.batchId).toBe(b.batchId);
    expect(a.batchId).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('does NOT return or persist a private key / secret', async () => {
    const sig = '0x' + '33'.repeat(32);
    const services: any = {
      safe: { signMessage: vi.fn().mockResolvedValue(sig) },
    };
    // createBatchWallet derives the private key as keccak256(toBytes(signature)).
    const derivedPrivKey = keccak256(toBytes(sig));
    const result = await createBatchWallet(services);
    // The public surface is { batchId, batchAccount } only.
    expect(Object.keys(result).sort()).toEqual(['batchAccount', 'batchId']);
    // batchAccount is an object with an address (never a raw private-key string),
    // and the derived secret's hex value is NOT present in the serialized output.
    expect(typeof result.batchAccount).toBe('object');
    expect(result.batchAccount.address).toBe(getAddress(result.batchId));
    expect(JSON.stringify(result)).not.toContain(derivedPrivKey.slice(2));
  });

  it('different mocked signatures yield different batchIds (keccak derives from the sig)', async () => {
    const s1: any = { safe: { signMessage: vi.fn().mockResolvedValue('0x' + '44'.repeat(32)) } };
    const s2: any = { safe: { signMessage: vi.fn().mockResolvedValue('0x' + '55'.repeat(32)) } };
    const a = await createBatchWallet(s1);
    const b = await createBatchWallet(s2);
    expect(a.batchId).not.toBe(b.batchId);
  });
});

describe('invitation.factory — generateCardSecrets', () => {
  beforeEach(() => {
    mocks.qrToString.mockReset();
    mocks.qrToString.mockImplementation(() => Promise.resolve('<svg/>'));
  });

  it('returns exactly batch.amount cards', async () => {
    const batch = makeBatch({ amount: 5 });
    const cards = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);
    expect(cards).toHaveLength(5);
  });

  it('generates unique base64url nullifiers (22 chars for 16 bytes)', async () => {
    const batch = makeBatch({ amount: 8 });
    const cards = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);
    const nullifiers = cards.map((c) => c.nullifier);
    expect(new Set(nullifiers).size).toBe(8); // all unique
    for (const n of nullifiers) {
      expect(n).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('builds each card URL in the frozen producer shape', async () => {
    const batch = makeBatch({ amount: 3, survey: 'survey-abc' });
    const cards = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);
    for (const card of cards) {
      const expected =
        `${BASEURL}?n=${card.nullifier}&b=${batch.id}&sig=${card.signature}&s=${batch.survey}`;
      expect(card.url).toBe(expected);
    }
  });

  it('generates an SVG string for every card via QRCode.toString(url)', async () => {
    const batch = makeBatch({ amount: 4 });
    const cards = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);
    expect(mocks.qrToString).toHaveBeenCalledTimes(4);
    for (const card of cards) {
      expect(card.svgString).toBe('<svg/>');
      expect(mocks.qrToString).toHaveBeenCalledWith(card.url, expect.any(Object));
    }
  });

  it('CROWN JEWEL: every produced card URL round-trips through shared parseCardURL to surveyOwner === batch.id', async () => {
    const batch = makeBatch({ amount: 5 });
    const cards = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);

    for (const card of cards) {
      // Real shared consumer (relative-source-path import), real shared
      // signCardMessage (via @s3ntiment/shared mock re-export) — no stubs in the
      // signature/URL path. This pins the producer half of the handshake to the
      // exact bytes the respondents + on-chain registerInPool validate.
      // The card message is bound to the pool/contract/chain it was printed for,
      // so parseCardURL must be given the same context to recover the owner.
      const context = { poolId: batch.pool!, storeAddress: STORE_ADDRESS, chainId: CHAIN_ID };
      const parsed = await parseCardURL(card.url, context);
      expect(parsed).not.toBeNull();
      const data = parsed as CardData;
      expect(data.surveyOwner).toBe(batch.id);
      expect(data.nullifier).toBe(card.nullifier);
      expect(data.batchId).toBe(batch.id);
      expect(data.surveyId).toBe(batch.survey);
      expect(data.poolId).toBe(batch.pool);
    }
  });

  it('recovered nullifiers have no URL-special characters (base64url, padding stripped)', async () => {
    const batch = makeBatch({ amount: 1 });
    const [card] = await generateCardSecrets(batchOwner, batch, STORE_ADDRESS, CHAIN_ID);
    expect(card.nullifier).not.toMatch(/[+/=]/);
    // Deterministic example of the transform used by the producer.
    const ref = generatedNullifier();
    expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(ref).not.toContain('=');
  });
});

describe('invitation.factory — createCsvFile', () => {
  beforeEach(() => {
    mocks.saveAs.mockReset();
  });

  it('produces a quoted, newline-joined CSV string in a text/csv Blob', () => {
    const values = ['alpha', 'beta', 'gamma'];
    createCsvFile(values, 'invites');
    const blob = mocks.saveAs.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv');
    // Blob[string] is async; read synchronously via file() is not available in
    // node without jsdom, so verify through blob.arrayBuffer().
    return blob.arrayBuffer().then((buf: ArrayBuffer) => {
      const text = Buffer.from(buf).toString('utf8');
      expect(text).toBe('"alpha"\n"beta"\n"gamma"');
    });
  });

  it('calls saveAs with `${filename}.csv`', () => {
    createCsvFile(['x'], 'myInvites');
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), 'myInvites.csv');
  });

  it('quotes every value, including ones containing commas/quotes', () => {
    createCsvFile(['a,b', 'he said "hi"'], 'x');
    const blob = mocks.saveAs.mock.calls[0][0];
    return blob.arrayBuffer().then((buf: ArrayBuffer) => {
      const text = Buffer.from(buf).toString('utf8');
      expect(text).toBe('"a,b"\n"he said "hi""');
    });
  });
});

describe('invitation.factory — createZipFile', () => {
  beforeEach(() => {
    mocks.saveAs.mockReset();
    mocks.qrToString.mockImplementation(() => Promise.resolve('<svg/>'));
  });

  it('calls saveAs with s3ntiment-qr-codes-<surveyId>.zip and a Blob', async () => {
    const cards = await generateCardSecrets(batchOwner, makeBatch({ amount: 2 }), STORE_ADDRESS, CHAIN_ID);
    await createZipFile(cards, 'survey-123');
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = mocks.saveAs.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toBe('s3ntiment-qr-codes-survey-123.zip');
    // Real JSZip output is a non-trivial zip archive.
    const size = await blob.arrayBuffer().then((b: ArrayBuffer) => b.byteLength);
    expect(size).toBeGreaterThan(0);
  });
});
