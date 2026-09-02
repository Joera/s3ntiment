import { describe, it, expect } from 'vitest';
// Direct relative-source-path import (never the @s3ntiment/shared barrel).
import {
  validatePoolCreateInput,
  validateRegisterBuilderInput,
  validateSurveyCreateInput,
  validateSurveyUpdateInput,
  validateResultsInput,
  validateDelegationInput,
  validateScoreInput,
  validateUsageKeyInput,
  PoolCreateInputSchema,
  RegisterBuilderInputSchema,
  SurveyCreateInputSchema,
  SurveyUpdateInputSchema,
  ResultsInputSchema,
  DelegationInputSchema,
  ScoreInputSchema,
  UsageKeyInputSchema,
  zodRequiredFieldPaths,
} from './inputs.js';

/** Assert that calling fn() throws with a message naming the offending field. */
function assertFieldNamed(fn: () => unknown, field: string): void {
  expect(fn).toThrow(field);
}

const SIG = '0x1234';
const USER = '0xOrganiser';
const POOL = '0xpool';
const SAFE = '0xSafe';
const PKP_ID = '0xpkp1';
const PKP_DID = 'did:pkp:1';
const SURVEY_ID = 'survey-1';

// ============================================================================
// valid fixtures — each represents the exact shape the organiser FE builds
// ============================================================================

const validPoolCreate = { signature: SIG, userAddress: USER, poolId: POOL, safeAddress: SAFE };
const validRegisterBuilder = {
  signature: SIG,
  userAddress: USER,
  poolId: POOL,
  pkpId: PKP_ID,
  pkpDid: PKP_DID,
  safeAddress: SAFE,
};
const validSurveyCreate = {
  signature: SIG,
  userAddress: USER,
  surveyConfig: { id: SURVEY_ID, pool: POOL, title: 'Coffee?', groups: [], batches: [] },
  poolConfig: { pkpId: PKP_ID, pkpDid: PKP_DID, safe: SAFE, groupId: 'g-1' },
};
const validSurveyUpdate = {
  survey: { id: SURVEY_ID, pool: POOL, groups: [], queryIds: ['q-1'] },
  poolConfig: { safe: SAFE, pkpId: PKP_ID },
  surveyConfig: { id: SURVEY_ID },
};
const validResults = {
  auth: { signature: SIG, userAddress: USER },
  survey: ['q-1', 'q-2'],
  poolId: POOL,
  groups: [],
  poolConfig: { safe: SAFE, groupId: 'g-1' },
};
const validDelegation = {
  userDid: 'did:key:respondent',
  signature: SIG,
  userAddress: USER,
  poolId: POOL,
  poolConfig: { safe: SAFE, pkpId: PKP_ID, pkpDid: PKP_DID },
};
const validScore = { signature: SIG, signer: USER, poolId: POOL };
const validUsageKey = { userAddr: USER, signature: SIG, poolId: POOL };

// ============================================================================
// helpers to build per-field-broken fixtures
// ============================================================================

function missing<T extends object>(obj: T, key: keyof T): Omit<T, keyof T> {
  const { [key]: _omit, ...rest } = obj;
  return rest;
}

function empty<T extends object>(obj: T, key: keyof T): T {
  return { ...obj, [key]: '' } as T;
}

function wrongType<T extends object>(obj: T, key: keyof T, value: unknown): T {
  return { ...obj, [key]: value } as T;
}

// ============================================================================
// POST /api/pools — validatePoolCreateInput
// ============================================================================

describe('validatePoolCreateInput', () => {
  it('parses a valid pool-create payload', () => {
    const out = validatePoolCreateInput(validPoolCreate);
    expect(out).toEqual(validPoolCreate);
  });

  it('rejects missing signature', () => {
    assertFieldNamed(() => validatePoolCreateInput(missing(validPoolCreate, 'signature')), 'signature');
  });
  it('rejects missing userAddress', () => {
    assertFieldNamed(() => validatePoolCreateInput(missing(validPoolCreate, 'userAddress')), 'userAddress');
  });
  it('rejects missing poolId', () => {
    assertFieldNamed(() => validatePoolCreateInput(missing(validPoolCreate, 'poolId')), 'poolId');
  });
  it('rejects missing safeAddress', () => {
    assertFieldNamed(() => validatePoolCreateInput(missing(validPoolCreate, 'safeAddress')), 'safeAddress');
  });
  it('rejects empty signature (treated as missing)', () => {
    assertFieldNamed(() => validatePoolCreateInput(empty(validPoolCreate, 'signature')), 'signature');
  });
  it('rejects wrong-type poolId', () => {
    assertFieldNamed(() => validatePoolCreateInput(wrongType(validPoolCreate, 'poolId', 12345)), 'poolId');
  });
});

// ============================================================================
// POST /api/builder/register — validateRegisterBuilderInput
// ============================================================================

describe('validateRegisterBuilderInput', () => {
  it('parses a valid register-builder payload', () => {
    expect(validateRegisterBuilderInput(validRegisterBuilder)).toEqual(validRegisterBuilder);
  });

  const fields: (keyof typeof validRegisterBuilder)[] = [
    'signature', 'userAddress', 'poolId', 'pkpId', 'pkpDid', 'safeAddress',
  ];
  for (const f of fields) {
    it(`rejects missing ${f}`, () => {
      assertFieldNamed(() => validateRegisterBuilderInput(missing(validRegisterBuilder, f)), String(f));
    });
  }
  it('rejects wrong-type pkpDid', () => {
    assertFieldNamed(() => validateRegisterBuilderInput(wrongType(validRegisterBuilder, 'pkpDid', 9)), 'pkpDid');
  });
});

// ============================================================================
// POST /api/surveys — validateSurveyCreateInput
// ============================================================================

describe('validateSurveyCreateInput', () => {
  it('parses a valid survey-create payload', () => {
    const out = validateSurveyCreateInput(validSurveyCreate);
    expect(out.surveyConfig.id).toBe(SURVEY_ID);
    expect(out.surveyConfig.pool).toBe(POOL);
    expect(out.poolConfig.pkpId).toBe(PKP_ID);
  });

  it('rejects missing signature', () => {
    assertFieldNamed(() => validateSurveyCreateInput(missing(validSurveyCreate, 'signature')), 'signature');
  });
  it('rejects missing userAddress', () => {
    assertFieldNamed(() => validateSurveyCreateInput(missing(validSurveyCreate, 'userAddress')), 'userAddress');
  });
  it('rejects missing surveyConfig', () => {
    assertFieldNamed(() => validateSurveyCreateInput(missing(validSurveyCreate, 'surveyConfig')), 'surveyConfig');
  });
  it('rejects missing surveyConfig.id (nested)', () => {
    const broken = { ...validSurveyCreate, surveyConfig: missing(validSurveyCreate.surveyConfig, 'id') };
    assertFieldNamed(() => validateSurveyCreateInput(broken), 'surveyConfig.id');
  });
  it('rejects missing surveyConfig.pool (nested)', () => {
    const broken = { ...validSurveyCreate, surveyConfig: missing(validSurveyCreate.surveyConfig, 'pool') };
    assertFieldNamed(() => validateSurveyCreateInput(broken), 'surveyConfig.pool');
  });
  it('rejects missing poolConfig (pool identity)', () => {
    assertFieldNamed(() => validateSurveyCreateInput(missing(validSurveyCreate, 'poolConfig')), 'poolConfig');
  });
  it('rejects missing poolConfig.pkpId (nested)', () => {
    const broken = { ...validSurveyCreate, poolConfig: missing(validSurveyCreate.poolConfig, 'pkpId') };
    assertFieldNamed(() => validateSurveyCreateInput(broken), 'poolConfig.pkpId');
  });
  it('rejects missing poolConfig.pkpDid (nested)', () => {
    const broken = { ...validSurveyCreate, poolConfig: missing(validSurveyCreate.poolConfig, 'pkpDid') };
    assertFieldNamed(() => validateSurveyCreateInput(broken), 'poolConfig.pkpDid');
  });
  it('rejects missing poolConfig.safe (nested)', () => {
    const broken = { ...validSurveyCreate, poolConfig: missing(validSurveyCreate.poolConfig, 'safe') };
    assertFieldNamed(() => validateSurveyCreateInput(broken), 'poolConfig.safe');
  });
  it('rejects wrong-type surveyConfig', () => {
    assertFieldNamed(() => validateSurveyCreateInput(wrongType(validSurveyCreate, 'surveyConfig', 'nope')), 'surveyConfig');
  });
});

// ============================================================================
// PUT /api/surveys/:id — validateSurveyUpdateInput (two-arg, id-match)
// ============================================================================

describe('validateSurveyUpdateInput', () => {
  it('parses a valid survey-update payload', () => {
    const out = validateSurveyUpdateInput(validSurveyUpdate, SURVEY_ID);
    expect(out.surveyConfig.id).toBe(SURVEY_ID);
  });

  it('rejects missing survey (object)', () => {
    assertFieldNamed(() => validateSurveyUpdateInput(missing(validSurveyUpdate, 'survey'), SURVEY_ID), 'survey');
  });
  it('rejects missing poolConfig (object)', () => {
    assertFieldNamed(() => validateSurveyUpdateInput(missing(validSurveyUpdate, 'poolConfig'), SURVEY_ID), 'poolConfig');
  });
  it('rejects missing surveyConfig.id (nested)', () => {
    const broken = { ...validSurveyUpdate, surveyConfig: missing(validSurveyUpdate.surveyConfig, 'id') };
    assertFieldNamed(() => validateSurveyUpdateInput(broken, SURVEY_ID), 'surveyConfig.id');
  });
  it('rejects wrong-type survey (not an object)', () => {
    assertFieldNamed(() => validateSurveyUpdateInput(wrongType(validSurveyUpdate, 'survey', 'nope'), SURVEY_ID), 'survey');
  });
  it('rejects a surveyConfig.id that does not match the URL id (SURVEY_ID_MISMATCH)', () => {
    assertFieldNamed(() => validateSurveyUpdateInput(validSurveyUpdate, 'other-id'), 'surveyConfig.id');
  });
});

// ============================================================================
// POST /api/surveys/:id/results — validateResultsInput
// ============================================================================

describe('validateResultsInput', () => {
  it('parses a valid results payload', () => {
    const out = validateResultsInput(validResults);
    expect(out.survey).toEqual(['q-1', 'q-2']);
    expect(out.poolConfig.safe).toBe(SAFE);
  });

  it('rejects missing auth (object)', () => {
    assertFieldNamed(() => validateResultsInput(missing(validResults, 'auth')), 'auth');
  });
  it('rejects missing survey (query-ids array)', () => {
    assertFieldNamed(() => validateResultsInput(missing(validResults, 'survey')), 'survey');
  });
  it('rejects wrong-type survey (not an array)', () => {
    assertFieldNamed(() => validateResultsInput(wrongType(validResults, 'survey', 'q-1')), 'survey');
  });
  it('rejects missing poolId', () => {
    assertFieldNamed(() => validateResultsInput(missing(validResults, 'poolId')), 'poolId');
  });
  it('rejects missing poolConfig.safe (nested)', () => {
    const broken = { ...validResults, poolConfig: missing(validResults.poolConfig, 'safe') };
    assertFieldNamed(() => validateResultsInput(broken), 'poolConfig.safe');
  });
  it('accepts groups (optional, not required by the boundary)', () => {
    const { groups, ...rest } = validResults;
    expect(validateResultsInput(rest).survey).toEqual(['q-1', 'q-2']);
  });
});

// ============================================================================
// POST /api/surveys/:surveyId/delegation — validateDelegationInput
// ============================================================================

describe('validateDelegationInput', () => {
  it('parses a valid delegation payload', () => {
    expect(validateDelegationInput(validDelegation).poolConfig.safe).toBe(SAFE);
  });

  it('rejects missing userDid', () => {
    assertFieldNamed(() => validateDelegationInput(missing(validDelegation, 'userDid')), 'userDid');
  });
  it('rejects missing signature', () => {
    assertFieldNamed(() => validateDelegationInput(missing(validDelegation, 'signature')), 'signature');
  });
  it('rejects missing userAddress', () => {
    assertFieldNamed(() => validateDelegationInput(missing(validDelegation, 'userAddress')), 'userAddress');
  });
  it('rejects missing poolId', () => {
    assertFieldNamed(() => validateDelegationInput(missing(validDelegation, 'poolId')), 'poolId');
  });
  it('rejects missing poolConfig.pkpId (nested)', () => {
    const broken = { ...validDelegation, poolConfig: missing(validDelegation.poolConfig, 'pkpId') };
    assertFieldNamed(() => validateDelegationInput(broken), 'poolConfig.pkpId');
  });
  it('rejects missing poolConfig.pkpDid (nested)', () => {
    const broken = { ...validDelegation, poolConfig: missing(validDelegation.poolConfig, 'pkpDid') };
    assertFieldNamed(() => validateDelegationInput(broken), 'poolConfig.pkpDid');
  });
});

// ============================================================================
// POST /api/surveys/:id/score — validateScoreInput
// ============================================================================

describe('validateScoreInput', () => {
  it('parses a valid score payload', () => {
    expect(validateScoreInput(validScore).signer).toBe(USER);
  });
  it('rejects missing signature', () => {
    assertFieldNamed(() => validateScoreInput(missing(validScore, 'signature')), 'signature');
  });
  it('rejects missing signer', () => {
    assertFieldNamed(() => validateScoreInput(missing(validScore, 'signer')), 'signer');
  });
  it('rejects missing poolId', () => {
    assertFieldNamed(() => validateScoreInput(missing(validScore, 'poolId')), 'poolId');
  });
});

// ============================================================================
// POST /api/lit/usage-key — validateUsageKeyInput
// ============================================================================

describe('validateUsageKeyInput', () => {
  it('parses a valid usage-key payload', () => {
    expect(validateUsageKeyInput(validUsageKey).userAddr).toBe(USER);
  });
  it('rejects missing userAddr', () => {
    assertFieldNamed(() => validateUsageKeyInput(missing(validUsageKey, 'userAddr')), 'userAddr');
  });
  it('rejects missing signature', () => {
    assertFieldNamed(() => validateUsageKeyInput(missing(validUsageKey, 'signature')), 'signature');
  });
  it('rejects missing poolId', () => {
    assertFieldNamed(() => validateUsageKeyInput(missing(validUsageKey, 'poolId')), 'poolId');
  });
});

// ============================================================================
// zodRequiredFieldPaths — the canonical required-field listing the backend
// conformance test pins against
// ============================================================================

describe('zodRequiredFieldPaths — canonical contract listing', () => {
  it('PoolCreate', () => {
    expect(zodRequiredFieldPaths(PoolCreateInputSchema)).toEqual(
      ['poolId', 'safeAddress', 'signature', 'userAddress'].sort(),
    );
  });
  it('RegisterBuilder', () => {
    expect(zodRequiredFieldPaths(RegisterBuilderInputSchema)).toEqual(
      ['pkpDid', 'pkpId', 'poolId', 'safeAddress', 'signature', 'userAddress'].sort(),
    );
  });
  it('SurveyCreate', () => {
    expect(zodRequiredFieldPaths(SurveyCreateInputSchema)).toEqual(
      ['poolConfig.pkpDid', 'poolConfig.pkpId', 'poolConfig.safe', 'signature', 'surveyConfig.id', 'surveyConfig.pool', 'userAddress'].sort(),
    );
  });
  it('SurveyUpdate', () => {
    expect(zodRequiredFieldPaths(SurveyUpdateInputSchema)).toEqual(
      ['poolConfig', 'survey', 'surveyConfig.id'].sort(),
    );
  });
  it('Results', () => {
    expect(zodRequiredFieldPaths(ResultsInputSchema)).toEqual(
      ['auth', 'poolConfig.safe', 'poolId', 'survey'].sort(),
    );
  });
  it('Delegation', () => {
    expect(zodRequiredFieldPaths(DelegationInputSchema)).toEqual(
      ['poolConfig.pkpDid', 'poolConfig.pkpId', 'poolConfig.safe', 'poolId', 'signature', 'userAddress', 'userDid'].sort(),
    );
  });
  it('Score', () => {
    expect(zodRequiredFieldPaths(ScoreInputSchema)).toEqual(
      ['poolId', 'signature', 'signer'].sort(),
    );
  });
  it('UsageKey', () => {
    expect(zodRequiredFieldPaths(UsageKeyInputSchema)).toEqual(
      ['poolId', 'signature', 'userAddr'].sort(),
    );
  });
});
