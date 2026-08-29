import { describe, it, expect } from 'vitest';
import { prepareAnswers, createUserDataObject } from './response.factory.js';

// A minimal survey config shaped like survey/types.Survey.
const survey = (): any => ({
  id: 'SURVEY_1',
  groups: [
    {
      id: 'g1',
      title: 'Main',
      questions: [
        { id: 'q_radio', question: 'Pick', type: 'radio', required: true, options: ['red', 'green', 'blue'] },
        { id: 'q_scale', question: 'Rate', type: 'scale', required: true, options: ['1', '2', '3', '4', '5'] },
        { id: 'q_check', question: 'Multi', type: 'checkbox', required: true, options: ['a', 'b', 'c'] },
        { id: 'q_text', question: 'Words', type: 'text', required: true },
        { id: 'q_scored', question: 'Scored', type: 'scored-single', required: true, options: ['x', 'y'] },
      ],
    },
  ],
});

const base = (over: Record<string, any>) => ({
  questionId: over.questionId,
  questionText: over.questionText ?? 'Q',
  questionType: over.questionType,
  answer: over.answer,
});

describe('prepareAnswers', () => {
  it('converts a radio answer to its option index', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_radio', questionType: 'radio', answer: 'green' })], survey());
    expect(out).toEqual({ questionId: 'q_radio', questionText: 'Q', questionType: 'radio', answer: 1 });
  });

  it('falls back to 0 for a radio answer not matching any option', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_radio', questionType: 'radio', answer: 'not-there' })], survey());
    expect(out.answer).toBe(0);
  });

  it('parses a scale answer to a number', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_scale', questionType: 'scale', answer: '4' })], survey());
    expect(out.answer).toBe(4);
  });

  it('coerces numeric scale answers through String()', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_scale', questionType: 'scale', answer: 3 })], survey());
    expect(out.answer).toBe(3);
  });

  it('falls back to 0 for a non-numeric scale answer', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_scale', questionType: 'scale', answer: 'NaN' })], survey());
    expect(out.answer).toBe(0);
  });

  it('maps checkbox answers to their option indexes, dropping unknown options', () => {
    const [out] = prepareAnswers(
      [base({ questionId: 'q_check', questionType: 'checkbox', answer: ['a', 'c', 'zzz'] })],
      survey(),
    );
    expect(out.answer).toEqual([0, 2]);
  });

  it('returns an empty array for a checkbox answer that is not an array', () => {
    const [out] = prepareAnswers([base({ questionId: 'q_check', questionType: 'checkbox', answer: 'a' })], survey());
    expect(out.answer).toEqual([]);
  });

  it('stringifies text (and other fallback question types) answers', () => {
    const [text] = prepareAnswers([base({ questionId: 'q_text', questionType: 'text', answer: 123 })], survey());
    expect(text.answer).toBe('123');
    const [scored] = prepareAnswers([base({ questionId: 'q_scored', questionType: 'scored-single', answer: 'x' })], survey());
    expect(scored.answer).toBe('x');
  });
});

describe('createUserDataObject', () => {
  it('builds the object envelope with _id, surveyId and signer', () => {
    const out = createUserDataObject('uuid-1', [], survey(), '0xsig');
    expect(out).toEqual({ _id: 'uuid-1', surveyId: 'SURVEY_1', signer: '0xsig' });
  });

  it('encodes a radio answer as a one-hot %allot field per option', () => {
    const out = createUserDataObject(
      'u1',
      [base({ questionId: 'q_radio', questionType: 'radio', answer: 'green' })],
      survey(),
      '0xsig',
    );
    expect(out.q_radio_0).toEqual({ '%allot': 0 });
    expect(out.q_radio_1).toEqual({ '%allot': 1 });
    expect(out.q_radio_2).toEqual({ '%allot': 0 });
  });

  it('encodes checkbox answers as binary %allot fields per selected option', () => {
    const out = createUserDataObject(
      'u2',
      [base({ questionId: 'q_check', questionType: 'checkbox', answer: ['a', 'c'] })],
      survey(),
      '0xsig',
    );
    expect(out.q_check_0).toEqual({ '%allot': 1 });
    expect(out.q_check_1).toEqual({ '%allot': 0 });
    expect(out.q_check_2).toEqual({ '%allot': 1 });
  });

  it('wraps a scale answer value in a %allot object', () => {
    const out = createUserDataObject(
      'u3',
      [base({ questionId: 'q_scale', questionType: 'scale', answer: 4 })],
      survey(),
      '0xsig',
    );
    expect(out.q_scale).toEqual({ '%allot': 4 });
  });

  it('stores a text answer as a plain string with no wrapping', () => {
    const out = createUserDataObject(
      'u4',
      [base({ questionId: 'q_text', questionType: 'text', answer: 'hello' })],
      survey(),
      '0xsig',
    );
    expect(out.q_text).toBe('hello');
  });

  it('wraps a scored-single answer value in a %allot object (else branch)', () => {
    // prepareAnswers stringifies then ensureAllot Numbers it; use a parseable
    // numeric string for a deterministic value.
    const out = createUserDataObject(
      'u5',
      [base({ questionId: 'q_scored', questionType: 'scored-single', answer: '2' })],
      survey(),
      '0xsig',
    );
    expect(out.q_scored).toEqual({ '%allot': 2 });
  });

  it('falls back to %allot 0 when an answer is null/undefined/NaN', () => {
    const out = createUserDataObject(
      'u7',
      [base({ questionId: 'q_scale', questionType: 'scale', answer: null })],
      survey(),
      '0xsig',
    );
    expect(out.q_scale).toEqual({ '%allot': 0 });
  });
});
