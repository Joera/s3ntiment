import { describe, it, expect } from 'vitest';
import { requiredFieldPaths } from './validation.js';
import {
  POOL_CREATE_OUTPUT_SCHEMA,
  SURVEY_CREATE_OUTPUT_SCHEMA,
  SURVEY_UPDATE_OUTPUT_SCHEMA,
  RESULTS_OUTPUT_SCHEMA,
  SCORE_OUTPUT_SCHEMA,
  REGISTER_BUILDER_OUTPUT_SCHEMA,
  DELEGATION_OUTPUT_SCHEMA,
  USAGE_KEY_OUTPUT_SCHEMA,
} from './outputs.js';
// The canonical zod OUTPUT schemas live in @s3ntiment/shared (the single shared
// location for response contracts). This backend stays zero-dep — it never
// imports zod itself, only the already-built schema consts to compare listings.
import {
  zodRequiredFieldPaths,
  PoolCreateOutputSchema,
  SurveyCreateOutputSchema,
  SurveyUpdateOutputSchema,
  ResultsOutputSchema,
  ScoreOutputSchema,
  RegisterBuilderOutputSchema,
  DelegationOutputSchema,
  UsageKeyOutputSchema,
} from '@s3ntiment/shared/nillcc';

// ============================================================================
// OUTPUT CONFORMANCE PIN
//
// The organiser / respondents FEs validate the responses they consume
// producer-side with zod schemas that live in
// @s3ntiment/shared/nillcc/outputs.ts. Those zod schemas MUST describe exactly
// the same required fields as the backend's actual response bodies, captured
// declaratively here in outputs.ts (hand-rolled, zero-dep). If either side
// drifts — a route stops returning a field the FE zod contract derefs, or the
// zod contract demands a field the backend no longer sends — this test fails
// and the PR cannot merge.
//
// Both walkers (zodRequiredFieldPaths in shared, requiredFieldPaths in
// validation.ts) use the same semantics: dotted paths, recursion into required
// object fields, and a required object with no required nested fields counts
// as a leaf at its own path.
// ============================================================================

const CASES: Array<{ name: string; backend: object; zod: object }> = [
  { name: 'POST /api/pools', backend: POOL_CREATE_OUTPUT_SCHEMA, zod: PoolCreateOutputSchema },
  { name: 'POST /api/surveys', backend: SURVEY_CREATE_OUTPUT_SCHEMA, zod: SurveyCreateOutputSchema },
  { name: 'PUT /api/surveys/:id', backend: SURVEY_UPDATE_OUTPUT_SCHEMA, zod: SurveyUpdateOutputSchema },
  { name: 'POST /api/surveys/:id/results', backend: RESULTS_OUTPUT_SCHEMA, zod: ResultsOutputSchema },
  { name: 'POST /api/surveys/:id/score', backend: SCORE_OUTPUT_SCHEMA, zod: ScoreOutputSchema },
  { name: 'POST /api/builder/register', backend: REGISTER_BUILDER_OUTPUT_SCHEMA, zod: RegisterBuilderOutputSchema },
  { name: 'POST /api/surveys/:surveyId/delegation', backend: DELEGATION_OUTPUT_SCHEMA, zod: DelegationOutputSchema },
  { name: 'POST /api/lit/usage-key', backend: USAGE_KEY_OUTPUT_SCHEMA, zod: UsageKeyOutputSchema },
];

describe('backend response shapes === shared zod output schemas', () => {
  for (const c of CASES) {
    it(`${c.name} — hand-rolled response shape matches the zod output contract`, () => {
      expect(requiredFieldPaths(c.backend as Parameters<typeof requiredFieldPaths>[0])).toEqual(
        zodRequiredFieldPaths(c.zod as Parameters<typeof zodRequiredFieldPaths>[0]),
      );
    });
  }
});
