import { describe, it, expect } from 'vitest';
import { tallyResults } from './tabulate.js';

// Groups mirroring survey/types QuestionGroup.
const groups = (_overrides: Record<string, any> = {}): any => {
  const g = {
    id: 'g1',
    title: 'Main',
    questions: [
      { id: 'q_text', question: 'Tell us', type: 'text', required: true },
      { id: 'q_radio', question: 'Pick one', type: 'radio', required: true, options: ['optA', 'optB', 'optC'] },
      { id: 'q_scale', question: 'Rate', type: 'scale', required: true, scaleRange: { min: 1, max: 5, minLabel: 'low', maxLabel: 'high' } },
      { id: 'q_check', question: 'Pick many', type: 'checkbox', required: true, options: ['c0', 'c1'] },
      { id: 'q_scored', question: 'Scored', type: 'scored-single', required: true, options: ['sA', 'sB', 'sC'] },
    ],
    scoring: { q_scored: { correctAnswer: 0, points: 4 } },
  };
  return [g];
};

const rows = [
  {
    q_text: 'first answer',
    q_radio: 'optB',
    q_scale: '4',
    q_check_0: 1,
    q_check_1: 0,
    q_scored: 'sA',
  },
  {
    q_text: 'second answer',
    q_radio: 'optB',
    q_scale: '5',
    q_check_0: 1,
    q_check_1: 1,
    q_scored: 'sC',
  },
  {
    q_text: '',
    q_radio: 'optA',
    q_scale: 'abc', // non-numeric -> filtered from scale values
    q_check_0: 0,
    q_check_1: 0,
    q_scored: 'sA',
  },
];

describe('tallyResults', () => {
  const tallied = tallyResults(rows, groups());

  it('tallies text responses, filtering empty/blank values', () => {
    const t = tallied.q_text;
    expect(t.type).toBe('text');
    expect(t.question).toBe('Tell us');
    expect(t.responses).toEqual(['first answer', 'second answer']);
    expect(t.count).toBe(2);
  });

  it('tallies radio answers by their stored option value', () => {
    const t = tallied.q_radio;
    expect(t.type).toBe('radio');
    expect(t.options).toEqual(['optA', 'optB', 'optC']);
    expect(t.counts).toEqual({ optA: 1, optB: 2 });
    expect(t.total).toBe(rows.length);
  });

  it('computes scale average (2dp), response count and ignores non-numeric', () => {
    const t = tallied.q_scale;
    expect(t.type).toBe('scale');
    expect(t.range).toEqual({ min: 1, max: 5, minLabel: 'low', maxLabel: 'high' });
    // values 4,5 -> avg 4.5
    expect(t.average).toBe('4.50');
    expect(t.responses).toBe(2);
    expect(t.total).toBe(rows.length);
  });

  it('returns 0 average when no numeric scale responses exist', () => {
    const t = tallyResults(
      [{ q_scale: 'nope' }, { q_scale: undefined }, { q_scale: null }],
      groups(),
    );
    expect(t.q_scale.average).toBe(0);
    expect(t.q_scale.responses).toBe(0);
    expect(t.q_scale.total).toBe(3);
  });

  it('counts checkbox selections per option field (%_i === 1)', () => {
    const t = tallied.q_check;
    expect(t.type).toBe('checkbox');
    expect(t.options).toEqual(['c0', 'c1']);
    expect(t.counts).toEqual({ 0: 2, 1: 1 });
    expect(t.total).toBe(rows.length);
  });

  it('tallies scored-single by mapping answers to option index', () => {
    const t = tallied.q_scored;
    expect(t.type).toBe('scored-single');
    expect(t.options).toEqual(['sA', 'sB', 'sC']);
    // sA at rows 0 & 2, sC at row 1 -> indexes 0 and 2
    expect(t.counts).toEqual({ 0: 2, 2: 1 });
    expect(t.total).toBe(rows.length);
  });

  it('attaches the correctAnswer index from the scoring map', () => {
    expect(tallied.q_scored.correctAnswer).toBe(0);
  });

  it('uses null correctAnswer when the question has no scoring entry', () => {
    const noScoring = [{ id: 'g', title: 'x', questions: [
      { id: 'qs', question: 'S', type: 'scored-single', required: true, options: ['a', 'b'] },
    ] }];
    const t = tallyResults([{ qs: 'b' }], noScoring as any);
    expect(t.qs.correctAnswer).toBeNull();
    expect(t.qs.counts).toEqual({ 1: 1 });
  });

  it('ignores scored-single answers whose option index is out of range', () => {
    const t = tallyResults([{ q_scored: 'not-an-option' }], groups());
    expect(t.q_scored.counts).toEqual({});
    expect(t.q_scored.total).toBe(1);
  });

  it('handles undefined groups without throwing', () => {
    expect(() => tallyResults([{ a: 1 }], undefined as any)).not.toThrow();
    expect(tallyResults([{ a: 1 }], undefined as any)).toEqual({});
  });
});
