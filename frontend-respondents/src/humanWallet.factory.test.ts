import { describe, it, expect, vi, beforeEach } from 'vitest';

// humanWallet.factory.ts imports `fetchSurvey` from the shared package root source.
// The functions under test (authenticate / hasParticipatingAccount) never call it,
// so we stub the whole shared source index to keep this a pure, node-env unit test
// (no Lit/Nillion/d3/browser globals dragged in). This is the extracted human-wallet
// flow (Task 1a) retained for the LATER post-survey persist route — it is NOT called
// at the survey entry gate anymore.
vi.mock('../../shared/src/shared', () => ({
  fetchSurvey: vi.fn(),
}));

import { authenticate, hasParticipatingAccount } from './humanWallet.factory.js';
import type { IServices } from './services.js';
// Committed deployment JSON — resolved via the s3ntiment-contracts workspace
// exports map (./deployments/*) so tests read the real address/abi.
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';

const POOL_ID = '0x0000000000000000000000000000000000000001';
const SIGNER = '0x00000000000000000000000000000000000000ab';
const SIGNED_INPUT = '0x1234';
const DERIVED_KEY = '0x00000000000000000000000000000000000000cd';

type DeepPartial<T> = { [K in keyof T]?: unknown };

function createFakeServices(overrides: DeepPartial<IServices> = {}): IServices {
  return {
    viem: { read: vi.fn() },
    waap: { login: vi.fn(), signMessage: vi.fn() },
    account: { updateSignerWithKey: vi.fn(), getSignerAddress: vi.fn() },
    ipfs: {},
    lit: {},
    nillDB: {},
    oprf: { getSecp256k1: vi.fn() },
    ...overrides,
  } as unknown as IServices;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('hasParticipatingAccount', () => {
  it('returns false without any on-chain read when getSignerAddress() === "0x"', async () => {
    const services = createFakeServices({
      account: { getSignerAddress: vi.fn(() => '0x') },
    });

    const result = await hasParticipatingAccount(services, POOL_ID);

    expect(result).toBe(false);
    expect(services.viem.read).not.toHaveBeenCalled();
  });

  it('reads isPoolMember via viem.read with [poolId, signerAddress]', async () => {
    const read = vi.fn().mockResolvedValue(true);
    const services = createFakeServices({
      account: { getSignerAddress: vi.fn(() => SIGNER) },
      viem: { read },
    });

    const result = await hasParticipatingAccount(services, POOL_ID);

    expect(result).toBe(true);
    expect(services.account.getSignerAddress).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(
      surveyStore.address,
      surveyStore.abi,
      'isPoolMember',
      [POOL_ID, SIGNER],
    );
  });

  it('surfaces the resolved isPoolMember value (false when not a member)', async () => {
    const read = vi.fn().mockResolvedValue(false);
    const services = createFakeServices({
      account: { getSignerAddress: vi.fn(() => SIGNER) },
      viem: { read },
    });

    const result = await hasParticipatingAccount(services, POOL_ID);

    expect(result).toBe(false);
    expect(read).toHaveBeenCalledWith(
      surveyStore.address,
      surveyStore.abi,
      'isPoolMember',
      [POOL_ID, SIGNER],
    );
  });
});

describe('authenticate', () => {
  it('walks the full login flow and returns true when already a participant', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const signMessage = vi.fn().mockResolvedValue(SIGNED_INPUT);
    const getSecp256k1 = vi.fn().mockResolvedValue(DERIVED_KEY);
    const updateSignerWithKey = vi.fn().mockResolvedValue(SIGNER);
    const read = vi.fn().mockResolvedValue(true);

    const services = createFakeServices({
      waap: { login, signMessage },
      oprf: { getSecp256k1 },
      account: {
        updateSignerWithKey,
        getSignerAddress: vi.fn(() => SIGNER),
      },
      viem: { read },
    });

    const result = await authenticate(services, POOL_ID);

    expect(result).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(
      `Sign in with your unlinkable account for respondent pool ${POOL_ID}`,
    );
    expect(getSecp256k1).toHaveBeenCalledWith(SIGNED_INPUT);
    expect(updateSignerWithKey).toHaveBeenCalledWith(DERIVED_KEY);
    // hasParticipatingAccount then consults the on-chain oracle
    expect(read).toHaveBeenCalledWith(
      surveyStore.address,
      surveyStore.abi,
      'isPoolMember',
      [POOL_ID, SIGNER],
    );
  });

  it('returns false when the derived participant is not a pool member', async () => {
    const services = createFakeServices({
      waap: {
        login: vi.fn().mockResolvedValue(undefined),
        signMessage: vi.fn().mockResolvedValue(SIGNED_INPUT),
      },
      oprf: { getSecp256k1: vi.fn().mockResolvedValue(DERIVED_KEY) },
      account: {
        updateSignerWithKey: vi.fn().mockResolvedValue(SIGNER),
        getSignerAddress: vi.fn(() => SIGNER),
      },
      viem: { read: vi.fn().mockResolvedValue(false) },
    });

    const result = await authenticate(services, POOL_ID);

    expect(result).toBe(false);
  });

  it('propagates rejection from waap.login and stops the flow', async () => {
    const login = vi.fn().mockRejectedValue(new Error('login failed'));
    const signMessage = vi.fn();
    const services = createFakeServices({ waap: { login, signMessage } });

    await expect(authenticate(services, POOL_ID)).rejects.toThrow('login failed');
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('propagates rejection from waap.signMessage', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const signMessage = vi.fn().mockRejectedValue(new Error('sign failed'));
    const getSecp256k1 = vi.fn();
    const services = createFakeServices({
      waap: { login, signMessage },
      oprf: { getSecp256k1 },
    });

    await expect(authenticate(services, POOL_ID)).rejects.toThrow('sign failed');
    expect(login).toHaveBeenCalledTimes(1);
    expect(getSecp256k1).not.toHaveBeenCalled();
  });

  it('propagates rejection from oprf.getSecp256k1', async () => {
    const services = createFakeServices({
      waap: {
        login: vi.fn().mockResolvedValue(undefined),
        signMessage: vi.fn().mockResolvedValue(SIGNED_INPUT),
      },
      oprf: { getSecp256k1: vi.fn().mockRejectedValue(new Error('oprf failed')) },
      account: { updateSignerWithKey: vi.fn() },
    });

    await expect(authenticate(services, POOL_ID)).rejects.toThrow('oprf failed');
    expect(services.account.updateSignerWithKey).not.toHaveBeenCalled();
  });

  it('propagates rejection from account.updateSignerWithKey', async () => {
    const updateSignerWithKey = vi
      .fn()
      .mockRejectedValue(new Error('signer failed'));
    const services = createFakeServices({
      waap: {
        login: vi.fn().mockResolvedValue(undefined),
        signMessage: vi.fn().mockResolvedValue(SIGNED_INPUT),
      },
      oprf: { getSecp256k1: vi.fn().mockResolvedValue(DERIVED_KEY) },
      account: {
        updateSignerWithKey,
        getSignerAddress: vi.fn(() => '0x'),
      },
    });

    await expect(authenticate(services, POOL_ID)).rejects.toThrow('signer failed');
    expect(updateSignerWithKey).toHaveBeenCalledWith(DERIVED_KEY);
    // never reaches the membership check
    expect(services.viem.read).not.toHaveBeenCalled();
  });
});
