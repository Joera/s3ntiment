import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests for fetchAndDecryptSurveyWithRespondent's NEW contract: the pool's
// pkpId is derived internally from the parsed EncryptedConfig (config.poolConfig)
// rather than taken from a caller-supplied (often undefined) poolConfig arg.
// Also pins the MISSING_POOL_CONFIG guard for stale pre-fix surveys.

const h = vi.hoisted(() => ({
  fetchLitApiKey: vi.fn(async () => 'lit-key-1'),
  decrypt: vi.fn(async () => JSON.stringify({ title: 'How do you like coffee?' })),
  signMessage: vi.fn(async () => 'sig-1'),
}));

vi.mock('../index.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    fetchLitApiKey: h.fetchLitApiKey,
    getDecryptForRespondentAction: vi.fn(() => 'decrypt-action'),
    compactAction: (a: any) => a,
  };
});

vi.mock('../helpers/retries.js', () => ({
  withRetry: vi.fn(async (fn: any) => fn(undefined as any)),
}));

import { fetchAndDecryptSurveyWithRespondent } from './survey.factory.js';

const DEPLOYMENT = { address: '0xstore', abi: [] };

const CONFIG_WITH_POOL = {
  surveyId: 'survey-1',
  poolId: '0xpool',
  nilDid: 'did:key:builder',
  encryptedForRespondent: { ciphertext: 'ct', dataToEncryptHash: 'h' },
  encryptedScoring: 'scoring',
  isScored: false,
  poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:pkp:1', groupId: '1' },
};

function services(overrides: any = {}) {
  const svc = {
    viem: { read: vi.fn(async () => ['cid-1', '0xpool', 100]) },
    ipfs: {
      fetchFromPinata: vi.fn(async () => JSON.stringify(CONFIG_WITH_POOL)),
    },
    account: {
      getSignerAddress: vi.fn(() => '0xuser'),
      signMessage: h.signMessage,
    },
    lit: { decrypt: h.decrypt },
    ...overrides,
  };
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.decrypt.mockResolvedValue(JSON.stringify({ title: 'How do you like coffee?' }));
});

describe('fetchAndDecryptSurveyWithRespondent (new signature)', () => {
  it('derives poolConfig internally from the EncryptedConfig and decrypts with config.poolConfig.pkpId', async () => {
    const svc = services();

    // NEW 4-arg call: (services, deployment, surveyId, backendUrl) — no poolConfig arg.
    const survey = await fetchAndDecryptSurveyWithRespondent(
      svc as any,
      DEPLOYMENT as any,
      'survey-1',
      'http://backend',
    );

    // decrypt used config.poolConfig.pkpId, not an external poolConfig
    expect(h.decrypt).toHaveBeenCalledWith(
      'lit-key-1',
      'pkp-1',
      CONFIG_WITH_POOL.encryptedForRespondent,
      '0xuser',
      'sig-1',
      'decrypt-action',
    );

    // the returned survey carries the poolConfig (spread from ...config)
    expect(survey.poolConfig).toEqual(CONFIG_WITH_POOL.poolConfig);
    expect(survey).toMatchObject({ id: 'survey-1', title: 'How do you like coffee?' });
  });

  it('throws MISSING_POOL_CONFIG (clear error) and does not decrypt for stale pre-fix surveys without poolConfig.pkpId', async () => {
    const svc = services();
    svc.ipfs.fetchFromPinata.mockResolvedValue(
      JSON.stringify({ ...CONFIG_WITH_POOL, poolConfig: undefined }),
    );

    await expect(
      fetchAndDecryptSurveyWithRespondent(svc as any, DEPLOYMENT as any, 'survey-1', 'http://backend'),
    ).rejects.toThrow(/MISSING_POOL_CONFIG.*no poolConfig\.pkpId/);

    // no decrypt attempted once the guard trips
    expect(h.decrypt).not.toHaveBeenCalled();
  });
});
