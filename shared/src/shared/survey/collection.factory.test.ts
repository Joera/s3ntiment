import { describe, it, expect } from 'vitest';
import { createSurveyCollectionSchema } from './collection.factory.js';

const config = (questions: any[]) => ({
  id: 'survey-xyz',
  groups: [{ id: 'g', title: 'Main', questions }],
});

describe('createSurveyCollectionSchema', () => {
  it('includes the base _id, surveyId and signer properties', () => {
    const out = createSurveyCollectionSchema(config([]));
    expect(out.schema.items.properties).toMatchObject({
      _id: { type: 'string', format: 'uuid' },
      surveyId: { type: 'string' },
      signer: { type: 'string' },
    });
    expect(out.schema.items.required).toEqual(['_id', 'surveyId']);
  });

  it('maps radio and scale questions to a %share object property', () => {
    const out = createSurveyCollectionSchema(config([
      { id: 'q_r', type: 'radio', options: ['a', 'b'] },
      { id: 'q_s', type: 'scale', options: ['1', '2'] },
    ]));
    expect(out.schema.items.properties.q_r).toEqual({
      type: 'object',
      properties: { '%share': { type: 'string' } },
    });
    expect(out.schema.items.properties.q_s).toEqual({
      type: 'object',
      properties: { '%share': { type: 'string' } },
    });
  });

  it('creates one %share field per checkbox option', () => {
    const out = createSurveyCollectionSchema(config([
      { id: 'q_c', type: 'checkbox', options: ['x', 'y', 'z'] },
    ]));
    expect(out.schema.items.properties.q_c_0).toEqual({
      type: 'object',
      properties: { '%share': { type: 'string' } },
    });
    expect(out.schema.items.properties.q_c_2).toBeDefined();
    expect(out.schema.items.properties.q_c_3).toBeUndefined();
  });

  it('represents text questions as a plain string property', () => {
    const out = createSurveyCollectionSchema(config([
      { id: 'q_t', type: 'text' },
    ]));
    expect(out.schema.items.properties.q_t).toEqual({ type: 'string' });
  });

  it('builds the schema envelope (array of unique items, draft-07)', () => {
    const out = createSurveyCollectionSchema(config([]));
    expect(out.schema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'array',
      uniqueItems: true,
      items: { type: 'object' },
    });
  });

  it('defaults to a "standard" collection type', () => {
    expect(createSurveyCollectionSchema(config([])).type).toBe('standard');
  });

  it('accepts an explicit "owned" collection type', () => {
    expect(createSurveyCollectionSchema(config([]), 'owned').type).toBe('owned');
  });

  it('uses config.id for both _id and name', () => {
    const out = createSurveyCollectionSchema(config([]));
    expect(out._id).toBe('survey-xyz');
    expect(out.name).toBe('survey-xyz');
  });

  it('falls back to title then "untitled" when id is absent', () => {
    const titled = createSurveyCollectionSchema({ title: 'My Survey', groups: [] } as any);
    expect(titled.name).toBe('My Survey');
    expect(titled._id).toBeUndefined();

    const untitled = createSurveyCollectionSchema({ groups: [] } as any);
    expect(untitled.name).toBe('untitled');
  });

  it('leaves properties as the base trio when there are no groups/questions', () => {
    const out = createSurveyCollectionSchema({ id: 'empty', groups: [] } as any);
    expect(Object.keys(out.schema.items.properties)).toEqual(['_id', 'surveyId', 'signer']);
  });
});
