import { describe, it, expect } from 'vitest';
import {
  requiredFieldPaths,
  POOL_CREATE_SCHEMA,
  SURVEY_CREATE_SCHEMA,
  SURVEY_UPDATE_SCHEMA,
  SCORE_SCHEMA,
  RESULTS_SCHEMA,
  DELEGATION_SCHEMA,
  REGISTER_BUILDER_SCHEMA,
  USAGE_KEY_SCHEMA,
} from './validation.js';
// The producer-side zod schemas live in @s3ntiment/shared (the single shared
// location for input contracts). This backend stays zero-dep — it never
// imports zod itself, only the already-built schema consts to compare listings.
import {
  zodRequiredFieldPaths,
  PoolCreateInputSchema,
  SurveyCreateInputSchema,
  SurveyUpdateInputSchema,
  ScoreInputSchema,
  ResultsInputSchema,
  DelegationInputSchema,
  RegisterBuilderInputSchema,
  UsageKeyInputSchema,
} from '@s3ntiment/shared/nillcc';

// ============================================================================
// CONFORMANCE PIN
//
// The organiser FE validates its payloads producer-side with zod schemas that
// live in @s3ntiment/shared/nillcc/inputs.ts. Those zod schemas MUST describe
// exactly the same required fields as the backend's hand-rolled FieldRule
// schemas in validation.ts. If either side drifts — the FE starts omitting a
// field the backend demands, or the backend starts demanding a field the FE
// zod contract does not list — this test fails and the PR cannot merge.
//
// Both walkers (zodRequiredFieldPaths in shared, requiredFieldPaths here) use
// the same semantics: dotted paths, recursion into required object fields, and
// a required object with no required nested fields counts as a leaf at its own
// path.
// ============================================================================

const CASES: Array<{ name: string; backend: ReturnType<typeof Object>; zod: object }> = [
  { name: 'POST /api/pools', backend: POOL_CREATE_SCHEMA, zod: PoolCreateInputSchema },
  { name: 'POST /api/builder/register', backend: REGISTER_BUILDER_SCHEMA, zod: RegisterBuilderInputSchema },
  { name: 'POST /api/surveys', backend: SURVEY_CREATE_SCHEMA, zod: SurveyCreateInputSchema },
  { name: 'PUT /api/surveys/:id', backend: SURVEY_UPDATE_SCHEMA, zod: SurveyUpdateInputSchema },
  { name: 'POST /api/surveys/:id/results', backend: RESULTS_SCHEMA, zod: ResultsInputSchema },
  { name: 'POST /api/surveys/:surveyId/delegation', backend: DELEGATION_SCHEMA, zod: DelegationInputSchema },
  { name: 'POST /api/surveys/:id/score', backend: SCORE_SCHEMA, zod: ScoreInputSchema },
  { name: 'POST /api/lit/usage-key', backend: USAGE_KEY_SCHEMA, zod: UsageKeyInputSchema },
];

describe('backend required fields === shared zod required fields', () => {
  for (const c of CASES) {
    it(`${c.name} — hand-rolled required fields match the zod contract`, () => {
      expect(requiredFieldPaths(c.backend as Parameters<typeof requiredFieldPaths>[0])).toEqual(
        zodRequiredFieldPaths(c.zod as Parameters<typeof zodRequiredFieldPaths>[0]),
      );
    });
  }
});
