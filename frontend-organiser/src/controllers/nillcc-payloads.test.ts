import { describe, it, expect } from 'vitest';
// Real producer-side zod validators from the shared package — NOT mocked. This
// test feeds the FE's ACTUAL payload-builder output through them, so any drift
// between what the organiser FE POSTs/PUTs and what the backend's boundary
// validation accepts is caught here (and pinned by the backend conformance
// test in nillcc-backend/src/conformance.test.ts).
import {
  validatePoolCreateInput,
  validateRegisterBuilderInput,
  validateSurveyCreateInput,
  validateSurveyUpdateInput,
  validateResultsInput,
  validateDelegationInput,
  validateScoreInput,
  validateUsageKeyInput,
} from '@s3ntiment/shared/nillcc';
import {
  buildPoolCreatePayload,
  buildRegisterBuilderPayload,
  buildSurveyCreatePayload,
  buildSurveyUpdatePayload,
  buildResultsPayload,
} from './nillcc-payloads.js';

const SIG = '0x1234';
const USER = '0xOrganiser';
const POOL = '0xpool';
const SAFE = '0xSafe';
const PKP_ID = '0xpkp1';
const PKP_DID = 'did:pkp:1';
const SURVEY_ID = 'survey-1';

// The pool identity the organiser stores after minting (backend /api/pools).
const poolConfig = { safe: SAFE, chainId: 8453, litNetwork: 'datil-dev', pkpId: PKP_ID, pkpDid: PKP_DID, groupId: 'g-1' };

describe('buildPoolCreatePayload', () => {
  it('shapes the POST /api/pools body', () => {
    const payload = buildPoolCreatePayload({ signature: SIG, userAddress: USER, poolId: POOL, safeAddress: SAFE });
    expect(payload).toEqual({ signature: SIG, userAddress: USER, poolId: POOL, safeAddress: SAFE });
  });
  it('validates through the real zod schema (feeds the valid fixture)', () => {
    const payload = buildPoolCreatePayload({ signature: SIG, userAddress: USER, poolId: POOL, safeAddress: SAFE });
    expect(() => validatePoolCreateInput(payload)).not.toThrow();
  });
});

describe('buildRegisterBuilderPayload', () => {
  it('shapes the POST /api/builder/register body', () => {
    const payload = buildRegisterBuilderPayload({ signature: SIG, userAddress: USER, poolId: POOL, pkpId: PKP_ID, pkpDid: PKP_DID, safeAddress: SAFE });
    expect(payload).toEqual({ signature: SIG, userAddress: USER, poolId: POOL, pkpId: PKP_ID, pkpDid: PKP_DID, safeAddress: SAFE });
  });
  it('validates through the real zod schema', () => {
    const payload = buildRegisterBuilderPayload({ signature: SIG, userAddress: USER, poolId: POOL, pkpId: PKP_ID, pkpDid: PKP_DID, safeAddress: SAFE });
    expect(() => validateRegisterBuilderInput(payload)).not.toThrow();
  });
});

describe('buildSurveyCreatePayload', () => {
  it('shapes the POST /api/surveys body (signature + surveyConfig + poolConfig)', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, title: 'Coffee?', groups: [], batches: [] };
    const payload = buildSurveyCreatePayload({ signature: SIG, userAddress: USER, surveyConfig, poolConfig });
    expect(payload).toEqual({ signature: SIG, userAddress: USER, surveyConfig, poolConfig });
  });
  it('feeds real builder output into the valid fixture — passes', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, title: 'Coffee?', groups: [], batches: [] };
    const payload = buildSurveyCreatePayload({ signature: SIG, userAddress: USER, surveyConfig, poolConfig });
    const out = validateSurveyCreateInput(payload);
    expect(out.surveyConfig.id).toBe(SURVEY_ID);
    expect(out.poolConfig.pkpId).toBe(PKP_ID);
  });
  it('fast-fails when the pool config is missing (no identity)', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, groups: [], batches: [] };
    const payload = buildSurveyCreatePayload({ signature: SIG, userAddress: USER, surveyConfig, poolConfig: undefined });
    expect(() => validateSurveyCreateInput(payload)).toThrow('poolConfig');
  });
});

describe('buildResultsPayload', () => {
  it('maps queryIds onto the wire name `survey` (backend required field)', () => {
    const payload = buildResultsPayload({
      auth: { signature: SIG, userAddress: USER },
      queryIds: ['q-1', 'q-2'],
      poolId: POOL,
      groups: [],
      poolConfig,
    });
    expect(payload).toEqual({
      auth: { signature: SIG, userAddress: USER },
      survey: ['q-1', 'q-2'],
      poolId: POOL,
      groups: [],
      poolConfig,
    });
    // Regression guard: the backend boundary requires `survey`, not `queryIds`.
    expect(payload).not.toHaveProperty('queryIds');
  });
  it('feeds real builder output into the valid fixture — passes', () => {
    const payload = buildResultsPayload({
      auth: { signature: SIG, userAddress: USER },
      queryIds: ['q-1', 'q-2'],
      poolId: POOL,
      groups: [],
      poolConfig,
    });
    const out = validateResultsInput(payload);
    expect(out.survey).toEqual(['q-1', 'q-2']);
  });
});

describe('buildSurveyUpdatePayload', () => {
  it('reshapes onto the wire contract { survey, poolConfig, surveyConfig:{id} }', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, groups: [], queryIds: ['q-1'] };
    const payload = buildSurveyUpdatePayload({ surveyId: SURVEY_ID, surveyConfig, poolConfig });
    expect(payload).toEqual({
      survey: surveyConfig,
      poolConfig,
      surveyConfig: { id: SURVEY_ID },
    });
    // Regression guard: the old body carried surveyId/safeAddress/poolId which
    // the update boundary rejects.
    expect(payload).not.toHaveProperty('surveyId');
    expect(payload).not.toHaveProperty('safeAddress');
    expect(payload).not.toHaveProperty('poolId');
  });
  it('feeds real builder output into the valid fixture — passes with matching URL id', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, groups: [], queryIds: ['q-1'] };
    const payload = buildSurveyUpdatePayload({ surveyId: SURVEY_ID, surveyConfig, poolConfig });
    expect(() => validateSurveyUpdateInput(payload, SURVEY_ID)).not.toThrow();
  });
  it('fast-fails when the URL id does not match surveyConfig.id', () => {
    const surveyConfig = { id: SURVEY_ID, pool: POOL, groups: [], queryIds: ['q-1'] };
    const payload = buildSurveyUpdatePayload({ surveyId: SURVEY_ID, surveyConfig, poolConfig });
    expect(() => validateSurveyUpdateInput(payload, 'other-id')).toThrow('surveyConfig.id');
  });
});

// Sanity: every mutating wire schema the FE can send is reachable and green on
// a representative fixture.
describe('all nillcc input schemas accept the FE wire shapes', () => {
  it('delegation', () => {
    const body = {
      userDid: 'did:key:respondent',
      signature: SIG,
      userAddress: USER,
      poolId: POOL,
      poolConfig: { safe: SAFE, pkpId: PKP_ID, pkpDid: PKP_DID },
    };
    expect(() => validateDelegationInput(body)).not.toThrow();
  });
  it('score', () => {
    const body = { signature: SIG, signer: USER, poolId: POOL };
    expect(() => validateScoreInput(body)).not.toThrow();
  });
  it('usage-key', () => {
    const body = { userAddr: USER, signature: SIG, poolId: POOL };
    expect(() => validateUsageKeyInput(body)).not.toThrow();
  });
});
