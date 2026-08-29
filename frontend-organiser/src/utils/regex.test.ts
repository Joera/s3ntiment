import { describe, it, expect } from 'vitest';
import { isCid, isDid, isDidKey } from './regex';

describe('utils/regex — isCid', () => {
  it('accepts a CIDv0 (Qm...) string', () => {
    expect(isCid('Qm' + 'a'.repeat(44))).toBe(true);
  });

  it('accepts a CIDv1 (b...) string', () => {
    expect(isCid('b' + 'a'.repeat(58))).toBe(true);
  });

  it('rejects non-CID / malformed strings', () => {
    expect(isCid('not-a-cid')).toBe(false);
    expect(isCid('Qm' + 'a'.repeat(40))).toBe(false); // too short
    expect(isCid('b' + 'a'.repeat(20))).toBe(false); // < 58 chars
  });
});

describe('utils/regex — isDid', () => {
  it('accepts a well-formed did:method:identifier', () => {
    expect(isDid('did:ethr:0x1234')).toBe(true);
    expect(isDid('did:web:example.com')).toBe(true);
  });

  it('rejects malformed DID strings', () => {
    expect(isDid('did')).toBe(false);
    expect(isDid('did:ethr')).toBe(false);
    expect(isDid('not-a-did')).toBe(false);
  });
});

describe('utils/regex — isDidKey', () => {
  it('accepts a well-formed did:key:z... string', () => {
    expect(isDidKey('did:key:z' + '6Lp3oEkJ1o'.slice(0, 0) + 'A'.repeat(50))).toBe(true);
  });

  it('rejects malformed did:key strings', () => {
    expect(isDidKey('did:key:abc')).toBe(false);
    expect(isDidKey('did:ethr:0x1234')).toBe(false);
  });
});
