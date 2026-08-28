import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). We keep the Node environment — no jsdom, no real Lit / NilDB /
// IPFS / Base RPC. The shared package and the in-package NillionPkpClient are
// both replaced with hand-rolled fakes.
//
// The shared barrel is unbuilt/gitignored, so the bare specifier would not
// resolve; mocking it here (the same approach as frontend-respondents
// auth-ctrlr.test.ts) keeps tests deterministic and offline.

const h = vi.hoisted(() => ({
  // Every NillionPkpClient instance created by the controller is captured here.
  clientInstances: [] as any[],
}));

vi.mock('@s3ntiment/shared', () => ({
  stripScoring: vi.fn((s: any) => ({
    safeConfigWithScoring: s,
    safeConfig: s,
    scoring: { scored: true },
  })),
  isScored: vi.fn((_groups: any) => true),
  createSurveyCollectionSchema: vi.fn(() => ({ name: 'n', type: 't', schema: {} })),
  createSurveyAggregationQuery: vi.fn((id: any) => ({ _id: `query-${id}` })),
  fetchSurveyAndParseCid: vi.fn(async () => ({ poolId: 'pool-1' })),
  calculateScore: vi.fn(() => 42),
  withRetry: vi.fn(async (fn: any) => fn()),
}));

vi.mock('./services/nildb.pkp.service.js', () => ({
  NillionPkpClient: class {
    createCollection = vi.fn(async () => ({ ok: true }));
    createQuery = vi.fn(async () => ({ ok: true }));
    getUserWriteDelegation = vi.fn(async () => ({ delegation: 'del-1' }));
    constructor(..._args: any[]) {
      h.clientInstances.push(this);
    }
  },
}));

import { SurveyController } from './survey.ctrlr.js';
import {
  stripScoring,
  isScored,
  createSurveyCollectionSchema,
  createSurveyAggregationQuery,
  fetchSurveyAndParseCid,
  calculateScore,
} from '@s3ntiment/shared';
import { NillionPkpClient } from './services/nildb.pkp.service.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0xpool123';
const CID = 'QmFakeCid';

function fakeDeps() {
  const litPoolKeys = {
    get: vi.fn(async () => 'usage-key-1'),
    set: vi.fn(),
  };
  const lit = {
    encrypt: vi.fn(async (_k: any, _id: any, data: any) => `enc:${data.length}`),
  };
  const nildb = {
    builderDid: { didString: 'did:key:builder' },
    encryptToBuilder: vi.fn(() => 'b64-encrypted'),
    decryptFromBuilder: vi.fn(() => ({ scoring: { q1: 2 }, groups: [] })),
    exists: vi.fn(async (..._a: any[]): Promise<any> => false),
    getResponseById: vi.fn(async (..._a: any[]): Promise<any> => ({ answer: 'x' })),
  };
  const ipfs = {
    uploadToPinata: vi.fn(async () => CID),
    fetchFromPinata: vi.fn(async () =>
      JSON.stringify({
        id: SURVEY_ID,
        pool: POOL_ID,
        encryptedForOwner: 'enc-owner',
        encryptedScoring: 'b64-encrypted',
        title: 'Do you like coffee?',
      }),
    ),
  };
  const viem = {
    read: vi.fn(async (..._a: any[]): Promise<any> => [CID, 1, 2]),
  };
  return { litPoolKeys, lit, nildb, ipfs, viem };
}

function surveyConfig() {
  return {
    pool: POOL_ID,
    id: SURVEY_ID,
    config: {
      pkpId: 'pkp-1',
      pkpDid: 'did:key:pkp1',
      safe: '0xSafE',
      queryIds: ['old-query'],
    },
    groups: [{ id: 'g1' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.clientInstances.length = 0;
});

describe('SurveyController.create', () => {
  it('builds an encrypted IPFS config and returns its CID (happy path)', async () => {
    const deps = fakeDeps();
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );
    const body = {
      signature: 'sig-1',
      userAddress: '0xUser',
      surveyConfig: surveyConfig(),
    };

    const cid = await ctrl.create(body);

    // Delegate pre-steps to shared helpers.
    expect(stripScoring).toHaveBeenCalledWith(body.surveyConfig);
    expect(isScored).toHaveBeenCalledWith(body.surveyConfig.groups);
    expect(createSurveyCollectionSchema).toHaveBeenCalled();
    expect(createSurveyAggregationQuery).toHaveBeenCalledWith(SURVEY_ID, body.surveyConfig.groups);

    // usage key fetched for the pool.
    expect(deps.litPoolKeys.get).toHaveBeenCalledWith(POOL_ID);

    // Aggregation query id recorded back onto the config.
    expect(body.surveyConfig.config.queryIds).toEqual([`query-${SURVEY_ID}`]);

    // Both audience encryptions go through lit, plus the builder-side scoring.
    expect(deps.lit.encrypt).toHaveBeenCalledTimes(2);
    expect(deps.nildb.encryptToBuilder).toHaveBeenCalledTimes(1);

    expect(cid).toBe(CID);
    const uploaded = JSON.parse((deps.ipfs.uploadToPinata as any).mock.calls[0][0]);
    expect(uploaded.nilDid).toBe('did:key:builder');
    expect(uploaded.encryptedScoring).toBe('b64-encrypted');
    expect(uploaded.isScored).toBe(true);
  });
});

describe('SurveyController.update', () => {
  it('re-encrypts and uploads an updated config, returning the CID', async () => {
    const deps = fakeDeps();
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );
    const survey = { id: SURVEY_ID, pool: POOL_ID, groups: [], queryIds: ['q-1'] };
    const poolConfig = { pkpId: 'pkp-1' };

    const cid = await ctrl.update({ survey, poolConfig });

    expect(deps.litPoolKeys.get).toHaveBeenCalledWith(POOL_ID);
    expect(deps.lit.encrypt).toHaveBeenCalledTimes(2);
    expect(deps.nildb.encryptToBuilder).toHaveBeenCalledTimes(1);
    expect(cid).toBe(CID);

    const uploaded = JSON.parse((deps.ipfs.uploadToPinata as any).mock.calls[0][0]);
    expect(uploaded.surveyId).toBe(SURVEY_ID);
    expect(uploaded.poolId).toBe(POOL_ID);
    expect(uploaded.queryIds).toEqual(['q-1']);
    expect(uploaded.isScored).toBe(true);
  });
});

describe('SurveyController.get', () => {
  it('fetches on-chain cid + IPFS config and strips the answer key', async () => {
    const deps = fakeDeps();
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );

    const result = await ctrl.get(SURVEY_ID);

    expect(deps.viem.read).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      'getSurvey',
      [SURVEY_ID],
    );
    expect(deps.ipfs.fetchFromPinata).toHaveBeenCalledWith(CID);
    expect(result).not.toHaveProperty('encryptedScoring');
    expect(result).toHaveProperty('title', 'Do you like coffee?');
    // Normalize/JSON identity check: the rest of the config is preserved.
    expect(result.id).toBe(SURVEY_ID);
  });

  it('returns null when no cid is stored on-chain (route maps to 404 NOT_FOUND)', async () => {
    const deps = fakeDeps();
    deps.viem.read.mockResolvedValue([null, 0, 0]);
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );

    const result = await ctrl.get(SURVEY_ID);
    expect(result).toBeNull();
    expect(deps.ipfs.fetchFromPinata).not.toHaveBeenCalled();
  });
});

describe('SurveyController.score', () => {
  it('returns the calculated score for an existing respondent', async () => {
    const deps = fakeDeps();
    deps.nildb.exists.mockResolvedValue(['doc-1']);
    deps.nildb.getResponseById.mockResolvedValue({ answer: 'a1' });
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );

    const score = await ctrl.score(SURVEY_ID, '0xRespondent');

    expect(deps.nildb.decryptFromBuilder).toHaveBeenCalledWith('b64-encrypted');
    expect(deps.nildb.exists).toHaveBeenCalledWith(SURVEY_ID, '0xRespondent');
    expect(deps.nildb.getResponseById).toHaveBeenCalledWith(SURVEY_ID, 'doc-1');
    expect(calculateScore).toHaveBeenCalled();
    expect(score).toBe(42);
  });

  it('returns false when the respondent has no stored response (not scored)', async () => {
    const deps = fakeDeps();
    deps.nildb.exists.mockResolvedValue(false);
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );

    const score = await ctrl.score(SURVEY_ID, '0xRespondent');
    expect(score).toBe(false);
    expect(deps.nildb.getResponseById).not.toHaveBeenCalled();
  });

  it('returns null when the survey carries no encrypted answer key (unscored)', async () => {
    const deps = fakeDeps();
    deps.ipfs.fetchFromPinata.mockResolvedValue(JSON.stringify({ noKey: true }));
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );

    const score = await ctrl.score(SURVEY_ID, '0xRespondent');
    expect(score).toBeNull();
    expect(deps.nildb.decryptFromBuilder).not.toHaveBeenCalled();
  });
});

describe('SurveyController.getUserDelegation', () => {
  it('fetches the survey and returns a write delegation built by the PKP client', async () => {
    const deps = fakeDeps();
    const ctrl = new SurveyController(
      deps.nildb,
      deps.lit,
      deps.litPoolKeys,
      deps.ipfs,
      deps.viem,
    );
    const poolConfig = { safe: '0xSafE', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' };

    const result = await ctrl.getUserDelegation(
      'sig-1',
      '0xUser',
      POOL_ID,
      poolConfig,
      SURVEY_ID,
      'did:key:user',
    );

    expect(deps.litPoolKeys.get).toHaveBeenCalledWith(POOL_ID);
    expect(fetchSurveyAndParseCid).toHaveBeenCalledWith(
      { viem: deps.viem, ipfs: deps.ipfs },
      { address: expect.any(String), abi: expect.any(Array) },
      SURVEY_ID,
    );

    // One PKP client was constructed for this pool.
    expect(h.clientInstances.length).toBe(1);
    expect(NillionPkpClient).toBeDefined();

    const client = h.clientInstances[0];
    expect(client.getUserWriteDelegation).toHaveBeenCalledWith(
      'sig-1',
      '0xUser',
      SURVEY_ID,
      'did:key:user',
      POOL_ID,
      'usage-key-1',
      'pkp-1',
      'did:key:pkp1',
    );
    expect(result).toEqual({ delegation: 'del-1' });
  });
});
