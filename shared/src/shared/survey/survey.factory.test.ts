import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests for fetchAndDecryptSurveyWithRespondent's NEW contract: the pool's
// pkpId is derived internally from the parsed EncryptedConfig (config.poolConfig)
// rather than taken from a caller-supplied (often undefined) poolConfig arg.
// Also pins the MISSING_POOL_CONFIG guard for stale pre-fix surveys.

const h = vi.hoisted(() => ({
  fetchLitApiKey: vi.fn(async () => 'lit-key-1'),
  decrypt: vi.fn(async (..._args: any[]) => JSON.stringify({ title: 'How do you like coffee?' })),
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

import { fetchAndDecryptSurveyWithOwner, fetchAndDecryptSurveyWithRespondent } from './survey.factory.js';

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

// create()-path EncryptedConfig: `...surveyConfig` spreads the Survey object
// which carries `pool` and NO `poolId` key (only update() writes poolId). This
// is the shape that triggered the delegation 403 incident, and the same latent
// bug existed on the owner-decrypt path until the pool id was sourced from the
// on-chain fetchSurvey record instead.
const CREATE_PATH_CONFIG = {
  id: 'survey-1',
  pool: '0xpool',
  nilDid: 'did:key:builder',
  encryptedForOwner: { ciphertext: 'ct', dataToEncryptHash: 'h' },
  encryptedForRespondent: { ciphertext: 'ct', dataToEncryptHash: 'h' },
  encryptedScoring: 'scoring',
  isScored: false,
  queryIds: ['q-1'],
};

function ownerServices(overrides: any = {}) {
  const svc = {
    viem: { read: vi.fn(async () => ['cid-1', '0xpool', 100]) },
    ipfs: {
      fetchFromPinata: vi.fn(async () => JSON.stringify(CREATE_PATH_CONFIG)),
    },
    safe: {
      getSignerAddress: vi.fn(() => '0xowner'),
      getAddress: vi.fn(() => '0xSafe'),
      signMessage: h.signMessage,
    },
    lit: { decrypt: h.decrypt },
    ...overrides,
  };
  return svc;
}

describe('fetchAndDecryptSurveyWithOwner (chain-sourced poolId)', () => {
  it('sources the poolId from the chain fetchSurvey, not the config, and bakes it into the owner-decrypt action', async () => {
    const svc = ownerServices();

    const survey = await fetchAndDecryptSurveyWithOwner(
      svc as any,
      DEPLOYMENT as any,
      'survey-1',
      { pkpId: 'pkp-1' } as any,
      'http://backend',
    );

    // Usage-key fetch used the on-chain poolId (config carries no poolId on the
    // create path).
    expect(h.fetchLitApiKey).toHaveBeenCalledWith(
      'http://backend',
      '0xowner',
      'sig-1',
      '0xpool',
      undefined,
    );

    // Owner-decrypt action baked the REAL poolId into isPoolSafe — not
    // 'undefined' (the byte-exact action whose CID no key permits).
    const decryptCall = h.decrypt.mock.calls[0];
    expect(decryptCall[0]).toBe('lit-key-1');
    expect(decryptCall[1]).toBe('pkp-1');
    expect(String(decryptCall[5])).toContain("isPoolSafe('0xSafe', '0xpool')");
    expect(String(decryptCall[5])).not.toContain('undefined');

    expect(survey).toMatchObject({ id: 'survey-1', pool: '0xpool' });
  });

  it('still decrypts for update-path configs that DO carry poolId (regression guard)', async () => {
    const svc = ownerServices();
    svc.ipfs.fetchFromPinata.mockResolvedValue(
      JSON.stringify({ ...CREATE_PATH_CONFIG, poolId: '0xpool' }),
    );

    const survey = await fetchAndDecryptSurveyWithOwner(
      svc as any,
      DEPLOYMENT as any,
      'survey-1',
      { pkpId: 'pkp-1' } as any,
      'http://backend',
    );

    expect(survey).toMatchObject({ id: 'survey-1' });
    expect(h.fetchLitApiKey).toHaveBeenCalledWith(
      'http://backend',
      '0xowner',
      'sig-1',
      '0xpool',
      undefined,
    );
    const decryptCall = h.decrypt.mock.calls[0];
    expect(String(decryptCall[5])).toContain("isPoolSafe('0xSafe', '0xpool')");
  });
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
