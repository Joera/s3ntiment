import { describe, it, expect } from 'vitest';
import { createSurveyAggregationQuery } from './queries.js';

const groups = (questions: any[]) => [{ id: 'g1', title: 'Main', questions }];

describe('createSurveyAggregationQuery', () => {
  it('adds a $sum stage for scale questions', () => {
    const out = createSurveyAggregationQuery('sv-1', groups([
      { id: 'rating', type: 'scale', options: ['1', '2', '3'] },
    ]));
    const groupStage = out.pipeline[0].$group;
    expect(groupStage.rating_sum).toEqual({ $sum: '$rating' });
  });

  it('adds per-option $sum stages for radio questions', () => {
    const out = createSurveyAggregationQuery('sv-2', groups([
      { id: 'q_radio', type: 'radio', options: ['a', 'b'] },
    ]));
    const groupStage = out.pipeline[0].$group;
    expect(groupStage.q_radio_0_sum).toEqual({ $sum: '$q_radio_0' });
    expect(groupStage.q_radio_1_sum).toEqual({ $sum: '$q_radio_1' });
  });

  it('adds per-option $sum stages for checkbox questions', () => {
    const out = createSurveyAggregationQuery('sv-3', groups([
      { id: 'q_check', type: 'checkbox', options: ['x', 'y', 'z'] },
    ]));
    const groupStage = out.pipeline[0].$group;
    expect(groupStage.q_check_2_sum).toEqual({ $sum: '$q_check_2' });
    expect(Object.keys(groupStage).filter(k => k.startsWith('q_check'))).toHaveLength(3);
  });

  it('skips text questions (no aggregation)', () => {
    const out = createSurveyAggregationQuery('sv-4', groups([
      { id: 'q_text', type: 'text' },
    ]));
    const groupStage = out.pipeline[0].$group;
    expect(groupStage.q_text_sum).toBeUndefined();
  });

  it('always adds a total_responses $sum:1 stage', () => {
    const out = createSurveyAggregationQuery('sv-5', groups([
      { id: 'q1', type: 'scale', options: ['1'] },
    ]));
    expect(out.pipeline[0].$group.total_responses).toEqual({ $sum: 1 });
  });

  it('names the query from the surveyId and binds the collection', () => {
    const out = createSurveyAggregationQuery('SURVEY_42', groups([]));
    expect(out.name).toBe('survey-SURVEY_42-aggregation');
    expect(out.collection).toBe('SURVEY_42');
    expect(out.variables).toEqual({});
  });

  it('emits a fresh non-empty uuid for _id on each call', () => {
    const a = createSurveyAggregationQuery('sv', groups([]));
    const b = createSurveyAggregationQuery('sv', groups([]));
    expect(a._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a._id).not.toBe(b._id);
  });
});
