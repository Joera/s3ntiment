import { describe, it, expect } from 'vitest';
// Direct relative-source-path import (never the @s3ntiment/shared barrel).
import {
  validatePoolCreateOutput,
  validateSurveyCreateOutput,
  validateSurveyUpdateOutput,
  validateResultsOutput,
  validateScoreOutput,
  validateRegisterBuilderOutput,
  validateDelegationOutput,
  validateUsageKeyOutput,
} from './outputs.js';

function assertFieldNamed(fn: () => unknown, field: string): void {
  expect(fn).toThrow(field);
}

describe('validatePoolCreateOutput', () => {
  it('parses the pool identity returned by POST /api/pools', () => {
    const out = validatePoolCreateOutput({ pkpId: '0xpkp', pkpDid: 'did:pkp:1', groupId: 'g-1' });
    expect(out.groupId).toBe('g-1');
  });
  it('accepts extra fields (backend does not return delegation, but non-strict strip)', () => {
    const out = validatePoolCreateOutput({ pkpId: '0xpkp', pkpDid: 'did:pkp:1', groupId: 'g-1', delegation: 'del' });
    expect(out.groupId).toBe('g-1');
  });
  it('rejects missing pkpId', () => {
    assertFieldNamed(() => validatePoolCreateOutput({ pkpDid: 'did:pkp:1', groupId: 'g-1' }), 'pkpId');
  });
  it('rejects missing groupId', () => {
    assertFieldNamed(() => validatePoolCreateOutput({ pkpId: '0xpkp', pkpDid: 'did:pkp:1' }), 'groupId');
  });
  it('rejects a NUMBER groupId (locks the string contract — the real Lit SDK returns a number)', () => {
    assertFieldNamed(() => validatePoolCreateOutput({ pkpId: '0xpkp', pkpDid: 'did:pkp:1', groupId: 12345 }), 'groupId');
  });
});

describe('validateSurveyCreateOutput / validateSurveyUpdateOutput', () => {
  it('parses { cid }', () => {
    expect(validateSurveyCreateOutput({ cid: 'QmCid' }).cid).toBe('QmCid');
    expect(validateSurveyUpdateOutput({ cid: 'QmCid' }).cid).toBe('QmCid');
  });
  it('rejects a missing cid', () => {
    assertFieldNamed(() => validateSurveyCreateOutput({}), 'cid');
    assertFieldNamed(() => validateSurveyUpdateOutput({}), 'cid');
  });
  it('rejects a non-string cid', () => {
    assertFieldNamed(() => validateSurveyCreateOutput({ cid: 123 }), 'cid');
  });
});

describe('validateResultsOutput', () => {
  it('parses { results }', () => {
    const out = validateResultsOutput({ results: [{ id: 'q-1' }] });
    expect(Array.isArray(out.results)).toBe(true);
  });
  it('rejects a missing results key', () => {
    assertFieldNamed(() => validateResultsOutput({}), 'results');
  });
});

describe('validateScoreOutput', () => {
  it('parses a numeric score', () => {
    expect(validateScoreOutput({ score: 7 }).score).toBe(7);
  });
  it('parses a boolean false score (no entry)', () => {
    expect(validateScoreOutput({ score: false }).score).toBe(false);
  });
  it('rejects a missing score key', () => {
    assertFieldNamed(() => validateScoreOutput({}), 'score');
  });
});

describe('validateRegisterBuilderOutput', () => {
  it('parses { ok: true }', () => {
    expect(validateRegisterBuilderOutput({ ok: true }).ok).toBe(true);
  });
  it('rejects a missing ok key', () => {
    assertFieldNamed(() => validateRegisterBuilderOutput({}), 'ok');
  });
});

describe('validateDelegationOutput', () => {
  it('parses { delegation }', () => {
    expect(validateDelegationOutput({ delegation: { id: 'del' } }).delegation).toBeDefined();
  });
  it('rejects a missing delegation key', () => {
    assertFieldNamed(() => validateDelegationOutput({}), 'delegation');
  });
});

describe('validateUsageKeyOutput', () => {
  it('parses { apiKey }', () => {
    expect(validateUsageKeyOutput({ apiKey: 'key-1' }).apiKey).toBe('key-1');
  });
  it('rejects a missing apiKey', () => {
    assertFieldNamed(() => validateUsageKeyOutput({}), 'apiKey');
  });
});
