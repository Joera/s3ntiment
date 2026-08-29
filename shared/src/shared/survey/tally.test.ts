import { describe, it, expect } from 'vitest';
import { combineShares } from './tally.js';

describe('combineShares', () => {
  it('sums numeric fields across arrays of rows', () => {
    const nodeResults = [
      [{ q1: 1, q2: 2 }, { q1: 3, q2: 4 }],
      [{ q1: 5, q2: 6 }, { q1: 7, q2: 8 }],
    ];
    expect(combineShares(nodeResults)).toEqual({ q1: 16, q2: 20 });
  });

  it('skips non-array node results entirely', () => {
    const nodeResults = [
      null,
      'not-an-array',
      42,
      { not: 'array' },
      [{ key: 5 }],
    ] as any;
    expect(combineShares(nodeResults)).toEqual({ key: 5 });
  });

  it('skips _id entries even when numeric', () => {
    const nodeResults = [
      [{ _id: 99, q1: 1 }, { _id: 100, q1: 2 }],
    ];
    expect(combineShares(nodeResults)).toEqual({ q1: 3 });
  });

  it('ignores non-number values (strings, booleans, objects)', () => {
    const nodeResults = [
      [{ q1: 10, q2: 'ten', q3: true, q4: { nested: 1 } }],
      [{ q1: 5, q2: 'more' }],
    ];
    expect(combineShares(nodeResults)).toEqual({ q1: 15 });
  });

  it('accumulates the same key across multiple rows and nodes', () => {
    const nodeResults = [
      [{ total: 1 }, { total: 1 }],
      [{ total: 1 }, { total: 1 }],
      [{ total: 1 }],
    ];
    expect(combineShares(nodeResults)).toEqual({ total: 5 });
  });

  it('returns an empty object for empty / all-junk input', () => {
    expect(combineShares([])).toEqual({});
    expect(combineShares([null, undefined, 'x'] as any)).toEqual({});
  });
});
