// ============================================================================
// NillCC route-boundary OUTPUT schemas (producer-conformance, schema-first)
// ============================================================================
//
// The organiser FE consumes a handful of nillcc responses ({cid}, the
// pool-create identity, {results}, ...). These zod schemas make the FE trust
// the shape it receives: validateXxxOutput is called on the parsed JSON before
// any destructure, so a changed/regressed backend response fails loudly with a
// field-named message instead of silently producing undefined downstream.
//
// Mirror of the exact response bodies in nillcc-backend/src/app.ts:
//   - POST /api/pools          -> { pkpId, pkpDid, groupId }   (pool.ctrlr create)
//   - POST /api/surveys        -> { cid }
//   - PUT  /api/surveys/:id    -> { cid }
//   - POST /api/surveys/:id/results    -> { results }
//   - POST /api/surveys/:id/score      -> { score }
//   - POST /api/builder/register       -> { ok: true }
//   - POST /api/surveys/:surveyId/delegation -> { delegation }
//   - POST /api/lit/usage-key           -> { apiKey }

import { z } from 'zod';

// ============================================================================
// POST /api/pools — pool identity minted by PoolController.create()
// ============================================================================

export const PoolCreateOutputSchema = z.object({
  pkpId: z.string().min(1, 'pkpId is required'),
  pkpDid: z.string().min(1, 'pkpDid is required'),
  groupId: z.string().min(1, 'groupId is required'),
});

export type PoolCreateOutput = z.infer<typeof PoolCreateOutputSchema>;

// ============================================================================
// POST /api/surveys + PUT /api/surveys/:id — both reply { cid }
// ============================================================================

export const SurveyCreateOutputSchema = z.object({
  cid: z.string().min(1, 'cid is required'),
});

export type SurveyCreateOutput = z.infer<typeof SurveyCreateOutputSchema>;

export const SurveyUpdateOutputSchema = z.object({
  cid: z.string().min(1, 'cid is required'),
});

export type SurveyUpdateOutput = z.infer<typeof SurveyUpdateOutputSchema>;

// ============================================================================
// POST /api/surveys/:id/results — { results } (opaque payload; presence-check)
// ============================================================================

export const ResultsOutputSchema = z.object({
  results: z.array(z.unknown()),
});

export type ResultsOutput = z.infer<typeof ResultsOutputSchema>;

// ============================================================================
// POST /api/surveys/:id/score — { score } (number | false | null)
// ============================================================================

export const ScoreOutputSchema = z.object({
  score: z.union([z.number(), z.boolean(), z.null()]),
});

export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;

// ============================================================================
// POST /api/builder/register — { ok: true }
// ============================================================================

export const RegisterBuilderOutputSchema = z.object({
  ok: z.boolean(),
});

export type RegisterBuilderOutput = z.infer<typeof RegisterBuilderOutputSchema>;

// ============================================================================
// POST /api/surveys/:surveyId/delegation — { delegation } (NUC token, a
// non-empty string built end-to-end as headerB64 + '.' + payloadB64 + '.' + sigB64)
// ============================================================================

export const DelegationOutputSchema = z.object({
  delegation: z.string().min(1, 'delegation is required'),
});

export type DelegationOutput = z.infer<typeof DelegationOutputSchema>;

// ============================================================================
// POST /api/lit/usage-key — { apiKey } (Lit usage key, a string)
// ============================================================================

export const UsageKeyOutputSchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
});

export type UsageKeyOutput = z.infer<typeof UsageKeyOutputSchema>;

// ============================================================================
// Per-endpoint validateXxxOutput fns (s2s validateXxxOutput pattern)
// ============================================================================

function fail(name: string, input: unknown, result: { error: { issues: { path: (string | number)[]; message: string }[] } }): never {
  const lines = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`${name} output validation failed:\n${lines}`);
}

export function validatePoolCreateOutput(output: unknown): PoolCreateOutput {
  const result = PoolCreateOutputSchema.safeParse(output);
  if (!result.success) return fail('Pool create', output, result);
  return result.data;
}

export function validateSurveyCreateOutput(output: unknown): SurveyCreateOutput {
  const result = SurveyCreateOutputSchema.safeParse(output);
  if (!result.success) return fail('Survey create', output, result);
  return result.data;
}

export function validateSurveyUpdateOutput(output: unknown): SurveyUpdateOutput {
  const result = SurveyUpdateOutputSchema.safeParse(output);
  if (!result.success) return fail('Survey update', output, result);
  return result.data;
}

export function validateResultsOutput(output: unknown): ResultsOutput {
  const result = ResultsOutputSchema.safeParse(output);
  if (!result.success) return fail('Results', output, result);
  return result.data;
}

export function validateScoreOutput(output: unknown): ScoreOutput {
  const result = ScoreOutputSchema.safeParse(output);
  if (!result.success) return fail('Score', output, result);
  return result.data;
}

export function validateRegisterBuilderOutput(output: unknown): RegisterBuilderOutput {
  const result = RegisterBuilderOutputSchema.safeParse(output);
  if (!result.success) return fail('Register builder', output, result);
  return result.data;
}

export function validateDelegationOutput(output: unknown): DelegationOutput {
  const result = DelegationOutputSchema.safeParse(output);
  if (!result.success) return fail('Delegation', output, result);
  return result.data;
}

export function validateUsageKeyOutput(output: unknown): UsageKeyOutput {
  const result = UsageKeyOutputSchema.safeParse(output);
  if (!result.success) return fail('Usage key', output, result);
  return result.data;
}
