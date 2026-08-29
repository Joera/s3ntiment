import { describe, it, expect } from 'vitest';
// Direct relative-source-path import (never the @s3ntiment/shared barrel).
import {
  isScored,
  stripScoring,
  calculateScore,
} from './scoring.factory.js';

type AnyGroup = any;

const scoredGroup = (): AnyGroup => ({
  id: 'g1',
  title: 'Scored group',
  questions: [
    { id: 'q1', type: 'scored-single', required: true, options: ['a', 'b', 'c'] },
  ],
});

const plainGroup = (): AnyGroup => ({
  id: 'g2',
  title: 'Plain group',
  questions: [{ id: 'q2', type: 'radio', required: true, options: ['x', 'y'] }],
});

describe('isScored', () => {
  it('returns true when any question type starts with "scored"', () => {
    expect(isScored([scoredGroup()])).toBe(true);
  });

  it('returns true when scored question is nested deeper past a plain group', () => {
    expect(isScored([plainGroup(), scoredGroup()])).toBe(true);
  });

  it('returns false for a group with only plain (non-scored) questions', () => {
    expect(isScored([plainGroup()])).toBe(false);
  });

  it('returns false for an empty groups array', () => {
    expect(isScored([])).toBe(false);
  });

  it('returns false for undefined/null groups (defensive guard)', () => {
    expect(isScored(undefined as any)).toBe(false);
    expect(isScored(null as any)).toBe(false);
  });

  it('returns false when a group carries no questions array', () => {
    expect(isScored([{ id: 'g', title: 'x' }] as any)).toBe(false);
  });
});

describe('stripScoring', () => {
  const survey = () => ({
    id: 'survey-1',
    groups: [
      {
        ...scoredGroup(),
        scoring: { q1: { correctAnswer: 0, points: 5 } },
      },
      plainGroup(),
    ],
  });

  it('extracts per-group scoring keyed by group.id', () => {
    const { scoring } = stripScoring(survey());
    expect(Object.keys(scoring)).toEqual(['g1']);
    expect(scoring.g1).toEqual({ q1: { correctAnswer: 0, points: 5 } });
  });

  it('does not include groups without scoring in the scoring map', () => {
    const { scoring } = stripScoring(survey());
    expect(scoring.g2).toBeUndefined();
  });

  it('strips the scoring sibling from the safeConfig groups', () => {
    const { safeConfig } = stripScoring(survey());
    expect(safeConfig.groups![0]).not.toHaveProperty('scoring');
    // Other group untouched.
    expect(safeConfig.groups![1]).not.toHaveProperty('scoring');
  });

  it('preserves all other group/question data after stripping', () => {
    const { safeConfig } = stripScoring(survey());
    expect(safeConfig.groups![0].id).toBe('g1');
    expect(safeConfig.groups![0].questions[0].type).toBe('scored-single');
    expect(safeConfig.id).toBe('survey-1');
  });

  it('leaves scoring attached in safeConfigWithScoring (same groups reference)', () => {
    const s = survey();
    const { safeConfigWithScoring } = stripScoring(s);
    expect(safeConfigWithScoring.groups).toBe(s.groups);
    expect(safeConfigWithScoring.groups![0].scoring).toEqual({
      q1: { correctAnswer: 0, points: 5 },
    });
  });
});

describe('calculateScore', () => {
  const groups = (): AnyGroup[] => [
    {
      id: 'g1',
      title: 'G1',
      questions: [
        { id: 'q1', type: 'scored-single', required: true, options: ['red', 'green', 'blue'] },
        { id: 'q2', type: 'scored-single', required: true, options: ['yes', 'no'] },
      ],
    },
    {
      id: 'g2',
      title: 'G2',
      questions: [{ id: 'q3', type: 'radio', required: true, options: ['a', 'b'] }],
    },
  ];

  const scoring = (): Record<string, any> => ({
    g1: {
      q1: { correctAnswer: 1, points: 5 }, // correct = 'green'
      q2: { correctAnswer: 0, points: 3 }, // correct = 'yes'
    },
    g2: {
      q3: { correctAnswer: 0, points: 2 }, // correct = 'a'
    },
  });

  it('scores the correct answers and returns absolute score and max', () => {
    const userData = { q1: 'green', q2: 'yes', q3: 'a' };
    const { score, max, pct } = calculateScore(scoring(), userData, groups());
    expect(score).toBe(10);
    expect(max).toBe(10);
    expect(pct).toBe(100);
  });

  it('awards partial credit per correct question', () => {
    const userData = { q1: 'green', q2: 'no', q3: 'a' };
    const { score, max, pct } = calculateScore(scoring(), userData, groups());
    expect(score).toBe(7); // 5 + 0 + 2
    expect(max).toBe(10);
    expect(pct).toBe(70);
  });

  it('returns zero when nothing is correct', () => {
    const userData = { q1: 'red', q2: 'no', q3: 'b' };
    const { score, max, pct } = calculateScore(scoring(), userData, groups());
    expect(score).toBe(0);
    expect(max).toBe(10);
    expect(pct).toBe(0);
  });

  it('rounds fractional percentages to the nearest integer', () => {
    // scoring: q1=2pts, q2=1pt -> max 3
    const pts = {
      g1: {
        q1: { correctAnswer: 0, points: 2 }, // correct = 'red'
        q2: { correctAnswer: 0, points: 1 }, // correct = 'yes'
      },
    };
    const qs = [{ id: 'g1', questions: [
      { id: 'q1', options: ['red', 'green'] },
      { id: 'q2', options: ['yes', 'no'] },
    ] }] as any;
    // score 1 of max 3 -> 33.33 -> 33 (only q2 correct)
    expect(calculateScore(pts, { q1: 'green', q2: 'yes' }, qs).pct).toBe(33);
    // score 2 of max 3 -> 66.66 -> 67 (only q1 correct)
    expect(calculateScore(pts, { q1: 'red', q2: 'no' }, qs).pct).toBe(67);
  });

  it('guards max === 0 returning pct 0 (no points configured)', () => {
    const zeroPoints = {
      g1: { q1: { correctAnswer: 0, points: 0 } },
    };
    const { score, max, pct } = calculateScore(
      zeroPoints,
      { q1: 'red' },
      [{ id: 'g1', questions: [{ id: 'q1', options: ['red', 'green'] }] }] as any,
    );
    expect(score).toBe(0);
    expect(max).toBe(0);
    expect(pct).toBe(0);
  });

  it('skips a group that is present in scoring but missing from groups', () => {
    const { max, score } = calculateScore(
      { missing: { qx: { correctAnswer: 0, points: 5 } } },
      {},
      groups(),
    );
    expect(max).toBe(0);
    expect(score).toBe(0);
  });

  it('skips a question missing from the group or lacking options (no max added)', () => {
    const { max, score } = calculateScore(
      { g1: { ghost: { correctAnswer: 0, points: 9 } } },
      { ghost: 'x' },
      groups(),
    );
    expect(max).toBe(0);
    expect(score).toBe(0);
  });

  it('handles an empty scoring map as fully unscored', () => {
    const { score, max, pct } = calculateScore({}, {}, groups());
    expect(score).toBe(0);
    expect(max).toBe(0);
    expect(pct).toBe(0);
  });
});
