import { describe, it, expect } from 'vitest';
import { ensureHex } from './hex';

describe('utils/hex — ensureHex', () => {
  it('returns a lowercased 0x-prefixed hex for a plain valid hex string', () => {
    expect(ensureHex('abcd')).toBe('0xabcd');
  });

  it('normalizes an existing 0x prefix and lowercases mixed-case input', () => {
    expect(ensureHex('0xAbCdEf')).toBe('0xabcdef');
    expect(ensureHex('0X12AB')).toBe('0x12ab');
  });

  it('throws on an empty string', () => {
    expect(() => ensureHex('')).toThrow(/empty/i);
  });

  it('throws on non-hex / malformed input', () => {
    expect(() => ensureHex('0xzz')).toThrow(/invalid/i);
    expect(() => ensureHex('12g4')).toThrow(/invalid/i);
    expect(() => ensureHex('0x123 456')).toThrow(/invalid/i);
  });
});
