// ====== OUTPUT-SHAPE DESCRIPTORS ======
//
// Dependency-free, declarative descriptors of the SUCCESS response bodies each
// Express route returns (mirroring validation.ts, but for the output side).
// The backend is deliberately zero-dep (no zod), so these hand-rolled
// descriptors live here and are pinned, field-for-field, against the canonical
// zod OUTPUT schemas in @s3ntiment/shared/nillcc/outputs.ts by
// nillcc-backend/src/outputs.conformance.test.ts. If either side drifts — a
// route stops returning a field the FE zod output contract derefs, or the zod
// contract demands a field the backend no longer sends — the conformance pin
// fails and the PR cannot merge.
//
// Descriptions mirror the exact `res.json(...)` bodies in app.ts:
//   - POST /api/pools                    -> { pkpId, pkpDid, groupId }   (201)
//   - POST /api/surveys                  -> { cid }                      (201)
//   - PUT  /api/surveys/:id              -> { cid }                      (200)
//   - POST /api/surveys/:id/results      -> { results }                  (200)
//   - POST /api/surveys/:id/score        -> { score }                    (200)
//   - POST /api/builder/register         -> { ok: true }                 (200)
//   - POST /api/surveys/:surveyId/delegation -> { delegation }           (200)
//   - POST /api/lit/usage-key            -> { apiKey }                   (200)

import type { ValidationSchema } from './validation.js';

export const POOL_CREATE_OUTPUT_SCHEMA: ValidationSchema = {
  pkpId: { required: true, type: 'string' },
  pkpDid: { required: true, type: 'string' },
  groupId: { required: true, type: 'string' },
};

export const SURVEY_CREATE_OUTPUT_SCHEMA: ValidationSchema = {
  cid: { required: true, type: 'string' },
};

export const SURVEY_UPDATE_OUTPUT_SCHEMA: ValidationSchema = {
  cid: { required: true, type: 'string' },
};

// { results } — an array of opaque rows (no nested required fields).
export const RESULTS_OUTPUT_SCHEMA: ValidationSchema = {
  results: { required: true, type: 'array' },
};

// { score } — number | false | null (no single scalar type to enforce; the
// field must simply be present).
export const SCORE_OUTPUT_SCHEMA: ValidationSchema = {
  score: { required: true },
};

export const REGISTER_BUILDER_OUTPUT_SCHEMA: ValidationSchema = {
  ok: { required: true, type: 'boolean' },
};

// { delegation } — opaque object (no nested required fields).
export const DELEGATION_OUTPUT_SCHEMA: ValidationSchema = {
  delegation: { required: true, type: 'object' },
};

export const USAGE_KEY_OUTPUT_SCHEMA: ValidationSchema = {
  apiKey: { required: true, type: 'string' },
};
