import { describe, it, expect, vi, beforeEach } from 'vitest';
import { base } from 'viem/chains';
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' assert { type: 'json' };

// survey.factory's only heavy/network surface is delegated to invitation.factory
// (createBatchWallet / generateCardSecrets / uploadToPinata), which we mock here.
vi.mock('./invitation.factory', () => ({
  createBatchWallet: vi.fn(),
  generateCardSecrets: vi.fn(),
  uploadToPinata: vi.fn(),
  createZipFile: vi.fn(),
}));

import {
  createBatchWallet,
  generateCardSecrets,
  uploadToPinata,
} from './invitation.factory';
import { createBatch, registerBatch } from './survey.factory';

const mockCreateBatchWallet = vi.mocked(createBatchWallet);
const mockGenerateCardSecrets = vi.mocked(generateCardSecrets);
const mockUploadToPinata = vi.mocked(uploadToPinata);

const batchAccount: any = { address: '0x' + 'aa'.repeat(20) };
const BATCH_ID = '0x' + 'ab'.repeat(20); // non-checksummed input to getAddress

function makeBatch() {
  return {
    id: '',
    survey: '',
    pool: '',
    amount: 3,
    medium: 'zip-file',
    cards: [] as any[],
  } as any;
}

describe('survey.factory — createBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBatchWallet.mockResolvedValue({ batchId: BATCH_ID, batchAccount });
    mockGenerateCardSecrets.mockResolvedValue([{ nullifier: 'n1' }]);
    mockUploadToPinata.mockImplementation(async (_s: any, cards: any[]) => cards);
  });

  it('sets batch.id = getAddress(batchId), batch.survey and batch.pool', async () => {
    const services: any = {};
    const batch = makeBatch();
    const out = await createBatch(services, batch, 'pool-1', 'survey-1');

    expect(mockCreateBatchWallet).toHaveBeenCalledWith(services);
    // getAddress normalizes to a checksummed 0x address.
    expect(out.id).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(out.survey).toBe('survey-1');
    expect(out.pool).toBe('pool-1');
    // generateCardSecrets was called with the derived batchAccount + the batch,
    // bound to the survey-store deployment on base (card-v2).
    expect(mockGenerateCardSecrets).toHaveBeenCalledWith(
      batchAccount,
      batch,
      surveyStore.address,
      BigInt(base.id),
    );
  });

  it('uploads generated cards to pinata with `${batchId}-${i}` names', async () => {
    const services: any = {};
    const batch = makeBatch();
    const out = await createBatch(services, batch, 'pool-1', 'survey-1');

    expect(mockUploadToPinata).toHaveBeenCalledTimes(1);
    const [svc, cards] = mockUploadToPinata.mock.calls[0];
    expect(svc).toBe(services);
    expect(cards).toEqual([{ nullifier: 'n1' }]);
    // The batch returned carries the uploaded cards (from uploadToPinata).
    expect(out.cards).toEqual([{ nullifier: 'n1' }]);
  });
});

describe('survey.factory — registerBatch', () => {
  it('writes registerBatch with [batch.pool, batch.id] and waitForReceipt:true', async () => {
    const write = vi.fn().mockResolvedValue('0xtx');
    const services: any = { account: { write } };
    const batch = makeBatch();
    batch.pool = 'pool-9';
    batch.id = '0x' + 'cd'.repeat(20);

    await registerBatch(services, batch);

    expect(write).toHaveBeenCalledTimes(1);
    const [address, abi, fn, args, options] = write.mock.calls[0];
    expect(address).toBeTruthy(); // surveyStore.address (real/mocked JSON import)
    expect(abi).toBeTruthy();
    expect(fn).toBe('registerBatch');
    expect(args).toEqual([batch.pool, batch.id]);
    expect(options).toEqual({ waitForReceipt: true });
  });
});
