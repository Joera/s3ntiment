// ============================================================================
// NillCC route-boundary INPUT schemas (producer-conformance, schema-first)
// ============================================================================
//
// Single source of truth for the request bodies the organiser frontend POSTs /
// PUTs to the nillcc backend. Mirrors, field-for-field, the hand-rolled
// boundary validators in nillcc-backend/src/validation.ts (PR #39) — that file
// is deliberately zero-dep, so this zod schema lives HERE in shared and the
// two representations are pinned together by the conformance test
// (nillcc-backend/src/conformance.test.ts) which asserts
// requiredFieldPaths(this schema) === requiredFieldPaths(backend schema).
//
// House pattern copied from the s2s monorepo (shared/src/rendering/action-io.ts):
//   export const XxxInputSchema = z.object({...});
//   export type XxxInput = z.infer<typeof XxxInputSchema>;
//   export function validateXxxInput(input: unknown): XxxInput  // safeParse,
//     throws an Error listing `${issue.path.join('.')}: ${issue.message}` lines.
//
// The organiser FE calls validateXxxInput at the exact point of payload
// construction (just before fetch) so a payload the backend would 400 on is
// fast-failed with a field-named message BEFORE the round-trip.

import { z } from 'zod';

// ============================================================================
// POST /api/pools — validatePoolCreate({ signature, userAddress, poolId, safeAddress })
// ============================================================================

export const PoolCreateInputSchema = z.object({
  signature: z.string().min(1, 'signature is required'),
  userAddress: z.string().min(1, 'userAddress is required'),
  poolId: z.string().min(1, 'poolId is required'),
  safeAddress: z.string().min(1, 'safeAddress is required'),
});

export type PoolCreateInput = z.infer<typeof PoolCreateInputSchema>;

// ============================================================================
// POST /api/builder/register — validateRegisterBuilder({ signature, userAddress,
// poolId, pkpId, pkpDid, safeAddress })
// ============================================================================

export const RegisterBuilderInputSchema = z.object({
  signature: z.string().min(1, 'signature is required'),
  userAddress: z.string().min(1, 'userAddress is required'),
  poolId: z.string().min(1, 'poolId is required'),
  pkpId: z.string().min(1, 'pkpId is required'),
  pkpDid: z.string().min(1, 'pkpDid is required'),
  safeAddress: z.string().min(1, 'safeAddress is required'),
});

export type RegisterBuilderInput = z.infer<typeof RegisterBuilderInputSchema>;

// ============================================================================
// POST /api/surveys — validateSurveyCreate({ signature, userAddress,
// surveyConfig{id,pool}, poolConfig{pkpId,pkpDid,safe} })
//
// The FE sends a full Survey as surveyConfig (id/pool/title/groups/...); the
// boundary only requires id + pool. poolConfig is the minted-pool identity
// enforcement point: pkpId / pkpDid / safe are all required (MISSING_POOL_CONFIG).
// ============================================================================

export const SurveyCreateInputSchema = z.object({
  signature: z.string().min(1, 'signature is required'),
  userAddress: z.string().min(1, 'userAddress is required'),
  surveyConfig: z.object({
    id: z.string().min(1, 'surveyConfig.id is required'),
    pool: z.string().min(1, 'surveyConfig.pool is required'),
  }),
  poolConfig: z.object({
    pkpId: z.string().min(1, 'poolConfig.pkpId is required'),
    pkpDid: z.string().min(1, 'poolConfig.pkpDid is required'),
    safe: z.string().min(1, 'poolConfig.safe is required'),
  }),
});

export type SurveyCreateInput = z.infer<typeof SurveyCreateInputSchema>;

// ============================================================================
// PUT /api/surveys/:id — validateSurveyUpdate({ survey, poolConfig,
// surveyConfig{id} }) with surveyConfig.id === URL id (SURVEY_ID_MISMATCH).
// `survey` and `poolConfig` must be objects; pool config fields are NOT
// required here (PR #38 — update is not the pool-identity enforcement point).
// ============================================================================

export const SurveyUpdateInputSchema = z.object({
  survey: z.object({}).passthrough(),
  poolConfig: z.object({}).passthrough(),
  surveyConfig: z.object({
    id: z.string().min(1, 'surveyConfig.id is required'),
  }),
});

export type SurveyUpdateInput = z.infer<typeof SurveyUpdateInputSchema>;

// ============================================================================
// POST /api/surveys/:id/results — validateResults({ auth, survey, poolId,
// poolConfig{safe} }). `survey` is the query-ids list (array of strings).
// ============================================================================

export const ResultsInputSchema = z.object({
  auth: z.object({}).passthrough(),
  survey: z.array(z.string()),
  poolId: z.string().min(1, 'poolId is required'),
  poolConfig: z.object({
    safe: z.string().min(1, 'poolConfig.safe is required'),
  }),
});

export type ResultsInput = z.infer<typeof ResultsInputSchema>;

// ============================================================================
// POST /api/surveys/:surveyId/delegation — validateDelegation({ userDid,
// signature, userAddress, poolId, poolConfig{safe,pkpId,pkpDid} })
// ============================================================================

export const DelegationInputSchema = z.object({
  userDid: z.string().min(1, 'userDid is required'),
  signature: z.string().min(1, 'signature is required'),
  userAddress: z.string().min(1, 'userAddress is required'),
  poolId: z.string().min(1, 'poolId is required'),
  poolConfig: z.object({
    safe: z.string().min(1, 'poolConfig.safe is required'),
    pkpId: z.string().min(1, 'poolConfig.pkpId is required'),
    pkpDid: z.string().min(1, 'poolConfig.pkpDid is required'),
  }),
});

export type DelegationInput = z.infer<typeof DelegationInputSchema>;

// ============================================================================
// POST /api/surveys/:id/score — validateScore({ signature, signer, poolId })
// ============================================================================

export const ScoreInputSchema = z.object({
  signature: z.string().min(1, 'signature is required'),
  signer: z.string().min(1, 'signer is required'),
  poolId: z.string().min(1, 'poolId is required'),
});

export type ScoreInput = z.infer<typeof ScoreInputSchema>;

// ============================================================================
// POST /api/lit/usage-key — validateUsageKey({ userAddr, signature, poolId })
// ============================================================================

export const UsageKeyInputSchema = z.object({
  userAddr: z.string().min(1, 'userAddr is required'),
  signature: z.string().min(1, 'signature is required'),
  poolId: z.string().min(1, 'poolId is required'),
});

export type UsageKeyInput = z.infer<typeof UsageKeyInputSchema>;

// ============================================================================
// Per-endpoint validateXxxInput fns
// ============================================================================

export function validatePoolCreateInput(input: unknown): PoolCreateInput {
  const result = PoolCreateInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Pool create input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateRegisterBuilderInput(input: unknown): RegisterBuilderInput {
  const result = RegisterBuilderInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Register builder input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateSurveyCreateInput(input: unknown): SurveyCreateInput {
  const result = SurveyCreateInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Survey create input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateSurveyUpdateInput(input: unknown, id: string): SurveyUpdateInput {
  const result = SurveyUpdateInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Survey update input validation failed:\n${lines}`);
  }
  if (result.data.surveyConfig.id !== id) {
    throw new Error(`Survey update input validation failed:\nsurveyConfig.id: must match the survey id in the URL (got ${result.data.surveyConfig.id}, expected ${id})`);
  }
  return result.data;
}

export function validateResultsInput(input: unknown): ResultsInput {
  const result = ResultsInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Results input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateDelegationInput(input: unknown): DelegationInput {
  const result = DelegationInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Delegation input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateScoreInput(input: unknown): ScoreInput {
  const result = ScoreInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Score input validation failed:\n${lines}`);
  }
  return result.data;
}

export function validateUsageKeyInput(input: unknown): UsageKeyInput {
  const result = UsageKeyInputSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Usage key input validation failed:\n${lines}`);
  }
  return result.data;
}

// ============================================================================
// requiredFieldPaths — canonical required-field listing for the conformance
// pin. Walks a zod OBJECT schema and returns the dotted path of every field
// that is not optional (recursing into nested objects). The nillcc-backend
// conformance test asserts this equals the same listing derived from the
// hand-rolled FieldRule schema in nillcc-backend/src/validation.ts.
// ============================================================================

function isOptionalShape(shape: z.ZodTypeAny): boolean {
  const tn = (shape as { _def?: { typeName?: string } })._def?.typeName;
  return tn === 'ZodOptional' || tn === 'ZodDefault' || shape instanceof z.ZodOptional;
}

function isObjectShape(shape: z.ZodTypeAny): boolean {
  const tn = (shape as { _def?: { typeName?: string } })._def?.typeName;
  return tn === 'ZodObject' || shape instanceof z.ZodObject;
}

export function zodRequiredFieldPaths(schema: z.ZodObject<any>): string[] {
  const out: string[] = [];
  const walk = (obj: z.ZodObject<any>, prefix: string): void => {
    for (const [key, rawShape] of Object.entries(obj.shape)) {
      const shape = rawShape as z.ZodTypeAny;
      const path = prefix ? `${prefix}.${key}` : key;
      if (isOptionalShape(shape)) continue;
      if (isObjectShape(shape)) {
        // An object with no required nested fields (e.g. `auth` / `survey` /
        // `poolConfig` on update, which the backend only requires to BE an
        // object) counts as a required leaf at its own path.
        const before = out.length;
        walk(shape as z.ZodObject<any>, path);
        if (out.length === before) out.push(path);
      } else {
        out.push(path);
      }
    }
  };
  walk(schema, '');
  return out.sort();
}

