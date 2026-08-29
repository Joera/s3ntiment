// @vitest-environment happy-dom
//
// Real-component test tranche for the <survey-questions> custom element
// (src/components/survey-questions.ts — the largest user-facing surface in the
// app, previously only vi.mock'ed in survey-ctrlr.test and never exercised for
// real). We run in the happy-dom environment (activated per-file), drive the
// actual custom element through its shadow DOM, and assert its real logic:
//   - group flattening (flatQuestions / totalSteps)
//   - step navigation (next / back, step bounds, last-step submit)
//   - required-field validation
//   - scoring-relevant answer collection (radio / checkbox / scale / text /
//     scored-single) and the enriched SurveyAnswer shape
//   - the isSubmitting submit guard
//   - the `survey-complete` CustomEvent dispatch
//   - answer-state mutation (append + upsert on revisit)
//
// No whole-module vi.mock: the component, its shared-asset imports and the real
// store are all loaded for real. The store is primed via setSurveyData, which
// is exactly what the production SurveyController does before the element is
// mounted.
//
// Note on the private-access casts ((el as any).flatQuestions, .handleNext, …):
// these reach into the real component's own state/methods — the subject code is
// not stubbed or mocked; we are still asserting genuine behaviour.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurveyQuestions } from './survey-questions.js';
import { store } from '../state/store.js';
import type { Survey, SurveyAnswer } from '@s3ntiment/shared';

const SURVEY_ID = 'survey-form-1';

// A two-group survey exercising every question type the component renders.
// Group A is scored: q1 (scored-single) carries real scoring semantics via its
// type; q2 is a scale — both feed the numbered/typed answer surface.
function buildSurvey(): Survey {
  return {
    id: SURVEY_ID,
    title: 'Coffee Preferences',
    introduction: 'Tell us about your coffee habits.',
    groups: [
      {
        id: 'g1',
        title: 'Taste',
        questions: [
          {
            id: 'q1',
            question: 'How do you take it?',
            type: 'scored-single',
            options: ['black', 'with-milk', 'with-sugar'],
            required: true,
          },
          {
            id: 'q2',
            question: 'Rate the bitterness',
            type: 'scale',
            scaleRange: { min: 1, max: 5, minLabel: 'Mild', maxLabel: 'Bitter' },
            required: false,
          },
          {
            id: 'q3',
            question: 'Any notes?',
            type: 'text',
            required: false,
          },
        ],
      },
      {
        id: 'g2',
        title: 'Habits',
        questions: [
          {
            id: 'q4',
            question: 'How often?',
            type: 'radio',
            options: ['daily', 'weekly'],
            required: true,
          },
          {
            id: 'q5',
            question: 'Which drinks?',
            type: 'checkbox',
            options: ['espresso', 'latte', 'cold-brew'],
            required: false,
          },
        ],
      },
    ],
  };
}

// Prime the real store with the survey, then mount a real element connected to
// the document (appendChild triggers connectedCallback synchronously, which
// loads the config, flattens groups and renders). Returns the live element.
function mountSurvey(survey: Survey = buildSurvey()): SurveyQuestions {
  store.clear();
  store.setSurveyData(SURVEY_ID, survey);
  const el = document.createElement('survey-questions') as SurveyQuestions;
  el.setAttribute('survey-id', SURVEY_ID);
  document.body.appendChild(el);
  return el;
}

function shadow(el: SurveyQuestions): ShadowRoot {
  const sh = el.shadowRoot!;
  expect(sh).not.toBeNull();
  return sh;
}

function checkInput(el: SurveyQuestions, name: string, value: string) {
  const input = shadow(el).querySelector(
    `input[name="${name}"][value="${value}"]`
  ) as HTMLInputElement;
  expect(input, `input[name=${name}][value=${value}] to exist`).not.toBeNull();
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickNext(el: SurveyQuestions) {
  const next = shadow(el).getElementById('nextBtn')!;
  expect(next).not.toBeNull();
  next.click();
}

function clickBack(el: SurveyQuestions) {
  const back = shadow(el).getElementById('backBtn')!;
  expect(back).not.toBeNull();
  back.click();
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  store.clear();
});

describe('group flattening', () => {
  it('flattens every group\'s questions into a sequential flat list', () => {
    const el = mountSurvey();
    // totalSteps is the count of flattened questions (getter over flatQuestions).
    expect(el.totalSteps).toBe(5);
    const flat = (el as any).flatQuestions as Array<any>;
    expect(flat).toHaveLength(5);
    // Order preserved across groups: q1..q3 (group 0) then q4..q5 (group 1).
    expect(flat.map((f) => f.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });

  it('annotates each flat question with its group title and group index', () => {
    const el = mountSurvey();
    const flat = (el as any).flatQuestions as Array<any>;
    expect(flat[0]).toMatchObject({ id: 'q1', groupTitle: 'Taste', groupIndex: 0 });
    expect(flat[2]).toMatchObject({ id: 'q3', groupTitle: 'Taste', groupIndex: 0 });
    expect(flat[3]).toMatchObject({ id: 'q4', groupTitle: 'Habits', groupIndex: 1 });
    expect(flat[4]).toMatchObject({ id: 'q5', groupTitle: 'Habits', groupIndex: 1 });
  });

  it('falls back to the loading screen when the survey has no groups', () => {
    const el = mountSurvey({ id: SURVEY_ID, title: 'Empty', groups: [] });
    expect(el.totalSteps).toBe(0);
    expect(shadow(el).textContent).toContain('Loading survey');
  });
});

describe('step navigation', () => {
  it('shows the first question on mount, then advances via Next', () => {
    const el = mountSurvey();
    expect(shadow(el).textContent).toContain('How do you take it?');
    // progress text tracks the current step (1-based of total)
    expect(shadow(el).textContent).toContain('Question 1 of 5');

    checkInput(el, 'q1', 'black'); // satisfy the required first question
    clickNext(el);
    expect(shadow(el).textContent).toContain('Rate the bitterness');
    expect(shadow(el).textContent).toContain('Question 2 of 5');
    expect((el as any).currentStep).toBe(1);
  });

  it('Back moves to the previous question and is disabled on the first step', () => {
    const el = mountSurvey();
    // Back is disabled on step 0.
    expect((shadow(el).getElementById('backBtn') as HTMLButtonElement).disabled).toBe(true);

    checkInput(el, 'q1', 'black');
    clickNext(el);
    const back = shadow(el).getElementById('backBtn') as HTMLButtonElement;
    expect(back.disabled).toBe(false);

    clickBack(el);
    expect((el as any).currentStep).toBe(0);
    expect(shadow(el).textContent).toContain('How do you take it?');
    expect((shadow(el).getElementById('backBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not move past the first step when Back is pressed at the bound', () => {
    const el = mountSurvey();
    clickBack(el); // already at step 0 → no-op
    expect((el as any).currentStep).toBe(0);
    expect(shadow(el).textContent).toContain('How do you take it?');
  });

  it('labels the last step button "Submit"', () => {
    const el = mountSurvey();
    // Fast-forward through the 4 non-terminal questions by answering each.
    checkInput(el, 'q1', 'black');
    clickNext(el);
    checkInput(el, 'q2', '3');
    clickNext(el);
    const textarea = shadow(el).querySelector('textarea[name="q3"]') as HTMLTextAreaElement;
    textarea.value = 'smooth'; textarea.dispatchEvent(new Event('input'));
    clickNext(el);
    checkInput(el, 'q4', 'daily');
    clickNext(el);
    // Now on q5, the last step → button reads Submit.
    const next = shadow(el).getElementById('nextBtn') as HTMLButtonElement;
    expect(next.textContent?.trim()).toBe('Submit');
    expect((el as any).currentStep).toBe(4);
  });
});

describe('required-field validation', () => {
  it('blocks advancing on a required question with no answer and shows an error', () => {
    const el = mountSurvey();
    const err = shadow(el).getElementById('error-message')!;
    expect(err.classList.contains('hidden')).toBe(true);

    clickNext(el); // q1 is required and unanswered

    expect((el as any).currentStep).toBe(0); // did not advance
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toBe('This question is required');
    expect((el as any).answers).toHaveLength(0); // nothing recorded
  });

  it('allows advancing once the required question is answered', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'with-milk');
    clickNext(el);
    expect((el as any).currentStep).toBe(1);
    const err = shadow(el).getElementById('error-message')!;
    expect(err.classList.contains('hidden')).toBe(true); // fresh render, error cleared
  });

  it('accepts an empty answer for a non-required question', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); // pass required q1
    clickNext(el);
    // q2 is a non-required scale; answer it, then q3 (text) is non-required and empty.
    checkInput(el, 'q2', '2');
    clickNext(el);
    // q3 text empty → should still advance (not required)
    clickNext(el);
    expect((el as any).currentStep).toBe(3);
  });

  it('allows an empty answer on a non-required checkbox (validation is required-only)', () => {
    // Observed real behaviour: isAnswerValid is only consulted for `required`
    // questions, so an unchecked non-required checkbox passes and advances.
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el);   // -> q2
    checkInput(el, 'q2', '3'); clickNext(el);       // -> q3
    const ta = shadow(el).querySelector('textarea[name="q3"]') as HTMLTextAreaElement;
    ta.value = 'x'; ta.dispatchEvent(new Event('input')); clickNext(el); // -> q4
    checkInput(el, 'q4', 'daily'); clickNext(el);   // -> q5 (non-required checkbox)
    expect((el as any).currentStep).toBe(4);

    clickNext(el); // zero selections on a non-required checkbox → advances
    expect((el as any).currentStep).toBe(5);
    expect((el as any).isSubmitting).toBe(true); // completion reached
  });

  it('blocks a required checkbox with zero selections (empty-array rejection)', () => {
    // A required checkbox is the one path that reaches isAnswerValid([]) and
    // rejects it, short-circuiting before the array-answer is stored.
    const requiredCheckboxSurvey: Survey = {
      id: SURVEY_ID,
      title: 'Required checkbox',
      groups: [
        {
          id: 'g1',
          title: 'Group',
          questions: [
            {
              id: 'cq1',
              question: 'Pick at least one',
              type: 'checkbox',
              options: ['a', 'b'],
              required: true,
            },
          ],
        },
      ],
    };
    const el = mountSurvey(requiredCheckboxSurvey);
    expect((el as any).currentStep).toBe(0);

    clickNext(el); // required checkbox unchecked → blocked with error
    expect((el as any).currentStep).toBe(0);
    expect((el as any).answers).toHaveLength(0);
    const err = shadow(el).getElementById('error-message')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toBe('This question is required');

    // selecting at least one lets it through
    checkInput(el, 'cq1', 'a');
    clickNext(el);
    expect((el as any).currentStep).toBe(1); // single-question survey → completed
    expect((el as any).answers).toHaveLength(1);
    expect(((el as any).answers as SurveyAnswer[])[0].answer).toEqual(['a']);
  });
});

describe('answer collection + enrichment (scoring-relevant)', () => {
  it('collects a radio/scored-single answer and stores a typed SurveyAnswer', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black');
    clickNext(el);
    const answers = (el as any).answers as SurveyAnswer[];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      questionId: 'q1',
      questionText: 'How do you take it?',
      questionType: 'scored-single',
      answer: 'black',
    });
  });

  it('collects a scale answer as a number and enriches with scaleRange', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    checkInput(el, 'q2', '4');
    clickNext(el);
    const answers = (el as any).answers as SurveyAnswer[];
    const q2 = answers.find((a) => a.questionId === 'q2')!;
    expect(q2.answer).toBe(4); // numeric
    expect(q2.questionType).toBe('scale');
    expect(q2.scaleRange).toEqual({ min: 1, max: 5, minLabel: 'Mild', maxLabel: 'Bitter' });
  });

  it('collects a text answer and trims surrounding whitespace', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    checkInput(el, 'q2', '3'); clickNext(el);     // -> q3
    const ta = shadow(el).querySelector('textarea[name="q3"]') as HTMLTextAreaElement;
    ta.value = '  notes here  '; ta.dispatchEvent(new Event('input'));
    clickNext(el);
    const answers = (el as any).answers as SurveyAnswer[];
    expect(answers.find((a) => a.questionId === 'q3')?.answer).toBe('notes here');
  });

  it('collects a checkbox answer as an array of selected values', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    checkInput(el, 'q2', '3'); clickNext(el);     // -> q3
    const ta = shadow(el).querySelector('textarea[name="q3"]') as HTMLTextAreaElement;
    ta.value = 'x'; ta.dispatchEvent(new Event('input')); clickNext(el); // -> q4
    checkInput(el, 'q4', 'daily'); clickNext(el); // -> q5 (checkbox)
    checkInput(el, 'q5', 'espresso');
    checkInput(el, 'q5', 'latte');
    clickNext(el);
    const answers = (el as any).answers as SurveyAnswer[];
    expect(answers.find((a) => a.questionId === 'q5')?.answer).toEqual(['espresso', 'latte']);
  });
});

describe('answer-state mutation on revisit', () => {
  it('updates (upserts) an existing answer when revisiting a question', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    // go back and change q1's answer
    clickBack(el);
    checkInput(el, 'q1', 'with-sugar');
    clickNext(el);

    const answers = (el as any).answers as SurveyAnswer[];
    expect(answers).toHaveLength(1); // still one entry for q1
    expect(answers[0].answer).toBe('with-sugar');
  });

  it('renders a saved answer as checked when returning to the question', () => {
    const el = mountSurvey();
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    clickBack(el); // back to q1 — saved answer should re-render checked
    const saved = shadow(el).querySelector(
      'input[name="q1"][value="black"]'
    ) as HTMLInputElement;
    expect(saved.checked).toBe(true);
  });
});

describe('submission: submit guard + survey-complete event', () => {
  function fillAll(el: SurveyQuestions) {
    checkInput(el, 'q1', 'black'); clickNext(el); // -> q2
    checkInput(el, 'q2', '3'); clickNext(el);     // -> q3
    const ta = shadow(el).querySelector('textarea[name="q3"]') as HTMLTextAreaElement;
    ta.value = 'smooth'; ta.dispatchEvent(new Event('input')); clickNext(el); // -> q4
    checkInput(el, 'q4', 'daily'); clickNext(el); // -> q5
    checkInput(el, 'q5', 'espresso'); clickNext(el); // -> submit (complete)
  }

  it('dispatches a composed+bubbling survey-complete CustomEvent with the answers', () => {
    const el = mountSurvey();
    const seen: any[] = [];
    el.addEventListener('survey-complete', (e: Event) => {
      seen.push((e as CustomEvent).detail);
      // bubbles + composed flags as produced by the component
      expect(e.bubbles).toBe(true);
      expect(e.composed).toBe(true);
      expect(e.type).toBe('survey-complete');
    });

    fillAll(el);

    expect(seen).toHaveLength(1);
    const detail = seen[0];
    expect(detail.answers).toHaveLength(5);
    expect(detail.answers.map((a: SurveyAnswer) => a.questionId)).toEqual([
      'q1', 'q2', 'q3', 'q4', 'q5',
    ]);
    expect(typeof detail.timestamp).toBe('string');
    expect(new Date(detail.timestamp).getTime()).not.toBeNaN();
    // documentId is undefined by default (previousDocument is unset on a fresh element)
    expect(detail.documentId).toBeUndefined();
    // completion screen rendered: currentStep advanced past the last question
    expect((el as any).currentStep).toBe(el.totalSteps);
  });

  it('locks submission once started (isSubmitting guard prevents a second complete)', () => {
    const el = mountSurvey();
    const emitted = vi.fn();
    el.addEventListener('survey-complete', emitted);

    fillAll(el);
    expect(emitted).toHaveBeenCalledTimes(1);

    // After complete() returns, isSubmitting=true. Any further handleNext is a
    // no-op (guard early-returns before touching the (now consumed) step state).
    expect(() => (el as any).handleNext()).not.toThrow();
    expect(emitted).toHaveBeenCalledTimes(1); // no second event
  });

  it('exposes the collected answers via getAnswers()', () => {
    const el = mountSurvey();
    fillAll(el);
    const answers = el.getAnswers();
    expect(answers).toHaveLength(5);
    expect(answers[0].questionId).toBe('q1');
  });

  it('leaves the element un-submitted (no event) when aborted mid-way', () => {
    const el = mountSurvey();
    const emitted = vi.fn();
    el.addEventListener('survey-complete', emitted);
    checkInput(el, 'q1', 'black'); clickNext(el); // only first question answered
    expect(emitted).not.toHaveBeenCalled();
  });
});

describe('custom element registration', () => {
  it('registers the element under the survey-questions tag', () => {
    expect(customElements.get('survey-questions')).toBe(SurveyQuestions);
  });
});
