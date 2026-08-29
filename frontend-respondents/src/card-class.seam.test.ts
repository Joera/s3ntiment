import { describe, it, expect, vi, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { signCardMessage } from '../../shared/src/shared/invites/encoding.js';

// Real shared Card class + parseCardURL, imported by DIRECT RELATIVE SOURCE
// PATH (mirroring card-signature.seam.test.ts) so these tests exercise the
// shared .ts source, never the unbuilt dist.
import { Card, parseCardURL } from '../../shared/src/shared/invites/card.factory.js';
import type { CardData } from '../../shared/src/shared/invites/types.js';

// Deterministic test identity — doubles as the batchId / signer.
const BATCH_PK =
  '0x00000000000000000000000000000000000000000000000000000000000000aa';
const batchOwner = privateKeyToAccount(BATCH_PK);
const BATCH_ID = batchOwner.address;

const NULLIFIER = 'respondent-123';
const SURVEY_ID = 'survey-abc';
const SIGNATURE = '0x1234567890abcdef';

const SURVEY_STORE = {
  address: '0x00000000000000000000000000000000000000be' as `0x${string}`,
  abi: [{ name: 'isNullifierUsed', type: 'function' }],
};

const POOL_ID = '0x00000000000000000000000000000000000000cd';

// card-v2: the card message is bound to pool/contract/chain. CONTEXT is what
// parseCardURL needs to reconstruct the digest and recover the survey owner.
const STORE_ADDRESS = `0x${'11'.repeat(20)}`;
const CHAIN_ID = 8453n;
const CONTEXT = { poolId: POOL_ID, storeAddress: STORE_ADDRESS, chainId: CHAIN_ID };

function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    nullifier: NULLIFIER,
    batchId: BATCH_ID,
    signature: SIGNATURE,
    surveyOwner: BATCH_ID,
    surveyId: SURVEY_ID,
    ...overrides,
  };
}

function fakeServices() {
  return {
    viem: { read: vi.fn() },
    account: { write: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Card.isUsed', () => {
  const services = fakeServices();

  it('reads isNullifierUsed with (address, abi, nullifier, batchId) via services.viem.read', async () => {
    const read = services.viem.read.mockResolvedValue(true);
    const card = new Card(makeCardData());

    const result = await card.isUsed(services, SURVEY_STORE, POOL_ID);

    expect(read).toHaveBeenCalledWith(
      SURVEY_STORE.address,
      SURVEY_STORE.abi,
      'isNullifierUsed',
      [POOL_ID, NULLIFIER, BATCH_ID],
    );
    expect(result).toBe(true);
  });

  it('surfaces the resolved value from the read (false when not used yet)', async () => {
    const read = services.viem.read.mockResolvedValue(false);
    const card = new Card(makeCardData());

    const result = await card.isUsed(services, SURVEY_STORE, POOL_ID);

    expect(read).toHaveBeenCalledWith(
      SURVEY_STORE.address,
      SURVEY_STORE.abi,
      'isNullifierUsed',
      [POOL_ID, NULLIFIER, BATCH_ID],
    );
    expect(result).toBe(false);
  });

  it('propagates a rejection from the viem read', async () => {
    services.viem.read.mockRejectedValue(new Error('onchain boom'));
    const card = new Card(makeCardData());

    await expect(card.isUsed(services, SURVEY_STORE, POOL_ID)).rejects.toThrow(
      'onchain boom',
    );
  });
});

describe('Card.register', () => {
  const services = fakeServices();

  it('writes registerInPool with (poolId, nullifier, batchId, signature) and receipt-waiting opts', async () => {
    const write = services.account.write.mockResolvedValue({ hash: '0xabc' });
    const card = new Card(makeCardData());

    const result = await card.register(services, SURVEY_STORE, POOL_ID);

    expect(write).toHaveBeenCalledWith(
      SURVEY_STORE.address,
      SURVEY_STORE.abi,
      'registerInPool',
      [POOL_ID, NULLIFIER, BATCH_ID, SIGNATURE],
      { waitForReceipt: true, confirmations: 2 },
    );
    expect(result).toEqual({ hash: '0xabc' });
  });

  it('passes the signature straight off the card data', async () => {
    // Signature is intrinsic to the card; register must forward exactly the
    // card's signature, not some other value.
    const write = services.account.write.mockResolvedValue(undefined);
    const card = new Card(makeCardData({ signature: '0xdeadbeef' }));

    await card.register(services, SURVEY_STORE, POOL_ID);

    expect(write.mock.calls[0][3]).toEqual([POOL_ID, NULLIFIER, BATCH_ID, '0xdeadbeef']);
  });

  it('propagates a rejection from the account write', async () => {
    services.account.write.mockRejectedValue(new Error('tx rejected'));
    const card = new Card(makeCardData());

    await expect(card.register(services, SURVEY_STORE, POOL_ID)).rejects.toThrow(
      'tx rejected',
    );
  });
});

describe('Card getters', () => {
  it('return the CardData values for surveyId / nullifier / batchId', () => {
    const card = new Card(makeCardData());

    expect(card.surveyId).toBe(SURVEY_ID);
    expect(card.nullifier).toBe(NULLIFIER);
    expect(card.batchId).toBe(BATCH_ID);
  });
});

describe('parseCardURL edge cases (beyond happy + missing-params, which are pinned by card-signature.seam)', () => {
  it('returns null for a malformed URL', async () => {
    await expect(parseCardURL('not-a-url')).resolves.toBeNull();
  });

  it('returns null when the signature is not a recoverable address (non-hex / weird)', async () => {
    const href = `http://respondent.local/?n=${NULLIFIER}&b=${BATCH_ID}&sig=not-a-hex-signature&s=${SURVEY_ID}`;
    // recoverMessageAddress throws on the malformed signature -> parseCardURL
    // catches it and returns null.
    await expect(parseCardURL(href, CONTEXT)).resolves.toBeNull();
  });

  it('tolerates extra query params beyond n/b/sig/s', async () => {
    const signature = await signCardMessage(batchOwner, CONTEXT, NULLIFIER, BATCH_ID);
    const href =
      `http://respondent.local/?n=${NULLIFIER}&b=${BATCH_ID}&sig=${signature}` +
      `&s=${SURVEY_ID}&utm_source=qr&utm_medium=print&foo=bar`;

    const data = await parseCardURL(href, CONTEXT);

    expect(data).not.toBeNull();
    const card = data as CardData;
    expect(card.nullifier).toBe(NULLIFIER);
    expect(card.surveyId).toBe(SURVEY_ID);
    expect(card.surveyOwner).toBe(BATCH_ID);
  });

  it('round-trips a URL-encoded nullifier (decodeURIComponent applied before digest+recover)', async () => {
    // base64url-style nullifier as the organiser generates; the escaped form is
    // what survives a real query string for nullifiers with reserved chars.
    const encodedNullifier = encodeURIComponent(NULLIFIER);
    const signature = await signCardMessage(batchOwner, CONTEXT, NULLIFIER, BATCH_ID);
    const href =
      `http://respondent.local/?n=${encodedNullifier}&b=${BATCH_ID}` +
      `&sig=${signature}&s=${SURVEY_ID}`;

    const data = await parseCardURL(href, CONTEXT);

    expect(data).not.toBeNull();
    const card = data as CardData;
    expect(card.nullifier).toBe(NULLIFIER);
    expect(card.batchId).toBe(BATCH_ID);
    expect(card.surveyOwner).toBe(BATCH_ID);
  });
});
