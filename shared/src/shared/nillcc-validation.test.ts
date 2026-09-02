import { describe, it, expect } from 'vitest';
import {
  NillccValidationError,
  throwOnFailure,
  validateBody,
  validateDelegation,
  validatePoolCreate,
  validateRegisterBuilder,
  validateResults,
  validateScore,
  validateSurveyCreate,
  validateSurveyUpdate,
  validateUsageKey,
  type ValidationSchema,
} from './nillcc-validation.js';

// The validators are the producer-side mirror of the nillcc backend route
// boundary (PR #39). For EVERY mutating route the frontends call we assert:
//   1. a valid payload passes (returns null), and
//   2. every field the backend would reject (missing / wrong type) is caught
//      locally (returns a failure) — including the #40 auth supersets.

const SIG = '0xsignature';
const ADDR = '0x00000000000000000000000000000000000000aa';
const POOL = '0xpool123';
const SAFE = '0xSafe';
const PKP_ID = '0xpkp123';
const PKP_DID = 'did:pkp:123';
const SURVEY_ID = 'survey-abc';

// ---- validateBody (walker) ----

describe('validateBody walker', () => {
  const schema: ValidationSchema = {
    sig: { required: true, type: 'string' },
    nested: {
      required: true,
      type: 'object',
      fields: { inner: { required: true, type: 'string' } },
    },
  };

  it('passes a valid body', () => {
    expect(validateBody({ sig: 'x', nested: { inner: 'y' } }, schema)).toBeNull();
  });

  it('rejects a non-object body (null / array / primitive)', () => {
    for (const bad of [null, [], 42, 'str']) {
      const f = validateBody(bad, schema);
      expect(f).not.toBeNull();
      expect(f!.error).toBe('INVALID_BODY');
    }
  });

  it('rejects a missing required field', () => {
    expect(validateBody({ nested: { inner: 'y' } }, schema)?.error).toBe('MISSING_FIELD');
  });

  it('rejects a required field that is an empty string', () => {
    expect(validateBody({ sig: '', nested: { inner: 'y' } }, schema)?.error).toBe(
      'MISSING_FIELD',
    );
  });

  it('rejects a wrong-type field', () => {
    expect(validateBody({ sig: 5, nested: { inner: 'y' } }, schema)?.error).toBe(
      'INVALID_FIELD_TYPE',
    );
  });

  it('rejects a nested schema violation', () => {
    expect(validateBody({ sig: 'x', nested: { inner: 5 } }, schema)?.error).toBe(
      'INVALID_FIELD_TYPE',
    );
  });
});

// ---- POST /api/pools (validatePoolCreate) ----

describe('validatePoolCreate', () => {
  const valid = { signature: SIG, userAddress: ADDR, poolId: POOL, safeAddress: SAFE };

  it('passes a valid create-pool payload', () => {
    expect(validatePoolCreate(valid)).toBeNull();
  });

  it.each(['signature', 'userAddress', 'poolId', 'safeAddress'])(
    'catches missing %s',
    (key) => {
      const { [key as keyof typeof valid]: _drop, ...rest } = valid;
      const f = validatePoolCreate(rest);
      expect(f).not.toBeNull();
      expect(f!.error).toBe('MISSING_FIELD');
    },
  );

  it('catches each wrong-typed field', () => {
    for (const key of Object.keys(valid)) {
      const bad = { ...valid, [key]: 42 };
      const f = validatePoolCreate(bad);
      expect(f).not.toBeNull();
      expect(f!.error).toBe('INVALID_FIELD_TYPE');
    }
  });
});

// ---- POST /api/surveys (validateSurveyCreate) ----

describe('validateSurveyCreate', () => {
  const valid = {
    signature: SIG,
    userAddress: ADDR,
    surveyConfig: { id: SURVEY_ID, pool: POOL, title: 'Coffee?' },
    poolConfig: { safe: SAFE, pkpId: PKP_ID, pkpDid: PKP_DID, groupId: 'g1' },
  };

  it('passes a valid create-survey payload', () => {
    expect(validateSurveyCreate(valid)).toBeNull();
  });

  it.each(['signature', 'userAddress'])('catches missing %s', (key) => {
    const { [key as 'signature']: _drop, ...rest } = valid;
    const f = validateSurveyCreate(rest);
    expect(f).not.toBeNull();
    expect(f!.error).toBe('MISSING_FIELD');
  });

  it('catches a missing surveyConfig', () => {
    const { surveyConfig: _drop, ...rest } = valid;
    expect(validateSurveyCreate(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a surveyConfig missing id or pool', () => {
    for (const missing of ['id', 'pool']) {
      const f = validateSurveyCreate({
        ...valid,
        surveyConfig: { ...valid.surveyConfig, [missing]: undefined },
      });
      expect(f).not.toBeNull();
      expect(f!.error).toBe('MISSING_FIELD');
    }
  });

  it('catches a surveyConfig.id that is not a string', () => {
    const f = validateSurveyCreate({ ...valid, surveyConfig: { ...valid.surveyConfig, id: 7 } });
    expect(f?.error).toBe('INVALID_FIELD_TYPE');
  });

  it('catches an absent poolConfig (the #37 crash class)', () => {
    const { poolConfig: _drop, ...rest } = valid;
    const f = validateSurveyCreate(rest);
    expect(f).not.toBeNull();
    expect(f!.error).toBe('MISSING_POOL_CONFIG');
  });

  it('catches a partial poolConfig (missing pkpId / pkpDid / safe)', () => {
    for (const missing of ['pkpId', 'pkpDid', 'safe']) {
      const { [missing as 'safe']: _drop, ...partial } = valid.poolConfig;
      const f = validateSurveyCreate({ ...valid, poolConfig: partial });
      expect(f).not.toBeNull();
      expect(f!.error).toBe('MISSING_POOL_CONFIG');
    }
  });
});

// ---- PUT /api/surveys/:id (validateSurveyUpdate, #40 superset) ----

describe('validateSurveyUpdate', () => {
  const valid = {
    signature: SIG,
    userAddress: ADDR,
    survey: { id: SURVEY_ID, pool: POOL, groups: [] },
    poolConfig: { safe: SAFE, pkpId: PKP_ID },
    surveyConfig: { id: SURVEY_ID },
  };

  it('passes a valid update payload with a matching id', () => {
    expect(validateSurveyUpdate(valid, SURVEY_ID)).toBeNull();
  });

  it('catches a surveyConfig.id that does not match the URL id', () => {
    const f = validateSurveyUpdate({ ...valid, surveyConfig: { id: 'other' } }, SURVEY_ID);
    expect(f).not.toBeNull();
    expect(f!.error).toBe('SURVEY_ID_MISMATCH');
  });

  it.each(['signature', 'userAddress'])('catches missing %s (#40 superset)', (key) => {
    const { [key as 'signature']: _drop, ...rest } = valid;
    expect(validateSurveyUpdate(rest, SURVEY_ID)?.error).toBe('MISSING_FIELD');
  });

  it.each(['survey', 'poolConfig'])('catches missing %s', (key) => {
    const { [key as 'survey']: _drop, ...rest } = valid;
    expect(validateSurveyUpdate(rest, SURVEY_ID)?.error).toBe('MISSING_FIELD');
  });

  it('catches a wrong-typed survey', () => {
    const f = validateSurveyUpdate({ ...valid, survey: [] }, SURVEY_ID);
    expect(f?.error).toBe('INVALID_FIELD_TYPE');
  });
});

// ---- POST /api/surveys/:id/score (validateScore) ----

describe('validateScore', () => {
  const valid = { signature: SIG, signer: ADDR, poolId: POOL };

  it('passes a valid score payload', () => {
    expect(validateScore(valid)).toBeNull();
  });

  it.each(['signature', 'signer', 'poolId'])('catches missing %s', (key) => {
    const { [key as 'signature']: _drop, ...rest } = valid;
    expect(validateScore(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a wrong-typed signer', () => {
    expect(validateScore({ ...valid, signer: 42 })?.error).toBe('INVALID_FIELD_TYPE');
  });
});

// ---- POST /api/surveys/:id/results (validateResults, #40 superset) ----

describe('validateResults', () => {
  const valid = {
    auth: { signature: SIG, userAddress: ADDR },
    survey: ['q1', 'q2'],
    poolId: POOL,
    groups: [{ id: 'g1' }],
    poolConfig: { safe: SAFE, pkpId: PKP_ID },
  };

  it('passes a valid results payload', () => {
    expect(validateResults(valid)).toBeNull();
  });

  it('catches a missing auth', () => {
    const { auth: _drop, ...rest } = valid;
    expect(validateResults(rest)?.error).toBe('MISSING_FIELD');
  });

  it.each(['signature', 'userAddress'])('catches missing auth.%s (#40 superset)', (key) => {
    const { [key as 'signature']: _drop, ...auth } = valid.auth;
    const f = validateResults({ ...valid, auth });
    expect(f).not.toBeNull();
    expect(f!.error).toBe('MISSING_FIELD');
  });

  it('catches a survey field that is not an array (queryIds shape)', () => {
    expect(validateResults({ ...valid, survey: 'q1' })?.error).toBe('INVALID_FIELD_TYPE');
  });

  it('catches a missing survey array (no queryIds)', () => {
    const { survey: _drop, ...rest } = valid;
    expect(validateResults(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a missing poolId', () => {
    const { poolId: _drop, ...rest } = valid;
    expect(validateResults(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a poolConfig missing safe', () => {
    const { safe: _drop, ...partial } = valid.poolConfig;
    expect(validateResults({ ...valid, poolConfig: partial })?.error).toBe('MISSING_FIELD');
  });
});

// ---- POST /api/surveys/:surveyId/delegation (validateDelegation) ----

describe('validateDelegation', () => {
  const valid = {
    userDid: 'did:key:seed',
    signature: SIG,
    userAddress: ADDR,
    poolId: POOL,
    poolConfig: { safe: SAFE, pkpId: PKP_ID, pkpDid: PKP_DID },
  };

  it('passes a valid delegation payload (submit + migrate)', () => {
    expect(validateDelegation(valid)).toBeNull();
  });

  it.each(['userDid', 'signature', 'userAddress', 'poolId'])('catches missing %s', (key) => {
    const { [key as 'userDid']: _drop, ...rest } = valid;
    expect(validateDelegation(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a poolConfig missing safe / pkpId / pkpDid', () => {
    for (const missing of ['safe', 'pkpId', 'pkpDid']) {
      const { [missing as 'safe']: _drop, ...partial } = valid.poolConfig;
      const f = validateDelegation({ ...valid, poolConfig: partial });
      expect(f).not.toBeNull();
      expect(f!.error).toBe('MISSING_FIELD');
    }
  });

  it('catches a wrong-typed poolId', () => {
    expect(validateDelegation({ ...valid, poolId: 7 })?.error).toBe('INVALID_FIELD_TYPE');
  });
});

// ---- POST /api/builder/register (validateRegisterBuilder) ----

describe('validateRegisterBuilder', () => {
  const valid = {
    signature: SIG,
    userAddress: ADDR,
    poolId: POOL,
    pkpId: PKP_ID,
    pkpDid: PKP_DID,
    safeAddress: SAFE,
  };

  it('passes a valid builder-register payload', () => {
    expect(validateRegisterBuilder(valid)).toBeNull();
  });

  it.each(Object.keys(valid))('catches missing %s', (key) => {
    const { [key as 'signature']: _drop, ...rest } = valid;
    expect(validateRegisterBuilder(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a wrong-typed pkpId', () => {
    expect(validateRegisterBuilder({ ...valid, pkpId: {} })?.error).toBe('INVALID_FIELD_TYPE');
  });
});

// ---- POST /api/lit/usage-key (validateUsageKey) ----

describe('validateUsageKey', () => {
  const valid = { userAddr: ADDR, signature: SIG, poolId: POOL };

  it('passes a valid usage-key payload', () => {
    expect(validateUsageKey(valid)).toBeNull();
  });

  it.each(['userAddr', 'signature', 'poolId'])('catches missing %s', (key) => {
    const { [key as 'userAddr']: _drop, ...rest } = valid;
    expect(validateUsageKey(rest)?.error).toBe('MISSING_FIELD');
  });

  it('catches a wrong-typed userAddr', () => {
    expect(validateUsageKey({ ...valid, userAddr: 42 })?.error).toBe('INVALID_FIELD_TYPE');
  });
});

// ---- throwOnFailure / NillccValidationError ----

describe('throwOnFailure', () => {
  it('is a no-op when the payload is valid', () => {
    expect(() => throwOnFailure(null)).not.toThrow();
    expect(() => throwOnFailure(validatePoolCreate({
      signature: SIG, userAddress: ADDR, poolId: POOL, safeAddress: SAFE,
    }))).not.toThrow();
  });

  it('throws a NillccValidationError carrying the backend error code', () => {
    let caught: any;
    try {
      throwOnFailure({ error: 'MISSING_POOL_CONFIG', message: 'boom' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NillccValidationError);
    expect(caught.error).toBe('MISSING_POOL_CONFIG');
    expect(caught.message).toBe('boom');
  });
});
