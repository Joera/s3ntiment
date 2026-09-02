// ============================================================================
// NILLCC API REQUEST-CONTRACT VALIDATION  (producer side / shared)
// ============================================================================
//
// This module is the PRODUCER-side mirror of the nillcc backend's route
// boundary validators (nillcc-backend/src/validation.ts, PR #39). The backend
// remains the authority and keeps its own copy; this shared module lets the
// organiser + respondents frontends validate the exact payload they are about
// to send, right before the fetch(), so a payload the backend would reject
// (400/401) is never produced/sent (fail-fast at the producer boundary).
//
// Why shared (placement decision):
//   - Both frontends already import from @s3ntiment/shared, so a single module
//     here gives both callers the SAME contract with ZERO duplication and zero
//     new dependencies.
//   - Keeping the backend copy separate (not re-exporting this) is deliberate:
//     refactoring the backend to re-export would change backend test counts /
//     behavior; the gate is that nillcc-backend stays untouched at its baseline.
//
// Hand-rolled, dependency-free (no zod/ajv) — a tiny declarative field walker,
// matching the ad-hoc guard style already used in the codebase and the exact
// schema/shape the backend validators require.
//
// Style notes (preserved from PR #39):
//   - Codes follow the SCREAMING_SNAKE convention (MISSING_POOL_CONFIG,
//     SURVEY_ID_MISMATCH, MISSING_FIELD, INVALID_FIELD_TYPE, INVALID_BODY).
//   - Pool config is OPTIONAL-by-default (PR #38): validators never demand the
//     full PoolConfig shape. The survey-CREATE path keeps requiring
//     poolConfig.pkpId / pkpDid / safe. Routes that genuinely need specific
//     config fields (results -> safe, delegation -> safe+pkpId+pkpDid) require
//     exactly those fields, nothing more.
//
// #40-aligned supersets (the ONLY intentional deviations from the backend copy):
//   - validateResults  also requires auth.signature + auth.userAddress — the
//     #40 results route reads them from body.auth (verifySignature authObject).
//   - validateSurveyUpdate also requires signature + userAddress — the #40 PUT
//     /surveys/:id route requires them. Backend #39 only checked survey/
//     poolConfig; this superset ensures a payload the backend will 401 on is
//     caught locally too.
// ============================================================================

export interface ValidationFailure {
  error: string;
  message: string;
}

export type FieldType = 'string' | 'object' | 'array' | 'number' | 'boolean';

export interface FieldRule {
  required?: boolean;
  type?: FieldType;
  /** Override the message when the field is missing. */
  requiredMessage?: string;
  /** Override the message when the field has the wrong type. */
  typeMessage?: string;
  /** Nested object schema (only applied when type === 'object'). */
  fields?: Record<string, FieldRule>;
}

export type ValidationSchema = Record<string, FieldRule>;

const TYPE_ARTICLE: Record<FieldType, string> = {
  string: 'a string',
  object: 'an object',
  array: 'an array',
  number: 'a number',
  boolean: 'a boolean',
};

function matchesType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

export function validateBody(body: unknown, schema: ValidationSchema): ValidationFailure | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_BODY', message: 'request body must be a JSON object' };
  }
  const record = body as Record<string, unknown>;
  for (const [key, rule] of Object.entries(schema)) {
    const value = record[key];
    // Required fields must be present and non-empty (empty string treated as missing).
    if (rule.required && (value === undefined || value === null || value === '')) {
      return { error: 'MISSING_FIELD', message: rule.requiredMessage ?? `missing ${key}` };
    }
    if (value === undefined || value === null) {
      continue;
    }
    if (rule.type && !matchesType(value, rule.type)) {
      return {
        error: 'INVALID_FIELD_TYPE',
        message: rule.typeMessage ?? `${key} must be ${TYPE_ARTICLE[rule.type]}`,
      };
    }
    if (rule.type === 'object' && rule.fields) {
      const nested = validateBody(value, rule.fields);
      if (nested) return nested;
    }
  }
  return null;
}

// ====== Per-route validators ======

// POST /api/pools — PoolController.create({ signature, userAddress, poolId, safeAddress })
// poolId / safeAddress keep their historical "missing poolId" / "missing safeAddress"
// messages (previously returned as bare strings by the controller guard).
export function validatePoolCreate(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    signature: { required: true, type: 'string' },
    userAddress: { required: true, type: 'string' },
    poolId: { required: true, type: 'string', requiredMessage: 'missing poolId' },
    safeAddress: { required: true, type: 'string', requiredMessage: 'missing safeAddress' },
  });
}

// POST /api/surveys — SurveyController.create({ signature, userAddress, surveyConfig, poolConfig })
// poolConfig must carry pkpId / pkpDid / safe — the canonical enforcement point
// for minted pool identity.
export function validateSurveyCreate(body: unknown): ValidationFailure | null {
  const base = validateBody(body, {
    signature: { required: true, type: 'string' },
    userAddress: { required: true, type: 'string' },
    surveyConfig: {
      required: true,
      type: 'object',
      fields: {
        id: { required: true, type: 'string' },
        pool: { required: true, type: 'string' },
      },
    },
  });
  if (base) return base;

  const poolConfig = (body as Record<string, any>).poolConfig;
  if (!poolConfig || typeof poolConfig !== 'object' || Array.isArray(poolConfig)) {
    return {
      error: 'MISSING_POOL_CONFIG',
      message: 'create-survey payload requires poolConfig with pkpId, pkpDid and safe',
    };
  }
  if (!poolConfig.pkpId || !poolConfig.pkpDid || !poolConfig.safe) {
    return {
      error: 'MISSING_POOL_CONFIG',
      message: 'create-survey payload requires poolConfig with pkpId, pkpDid and safe',
    };
  }
  return null;
}

// PUT /api/surveys/:id — SurveyController.update({ survey, poolConfig })
// Preserves the SURVEY_ID_MISMATCH guard (URL id vs body.surveyConfig.id).
// `survey` and `poolConfig` must be objects; pool config fields are NOT required.
// #40 superset: also requires signature + userAddress (the PUT route 401s on a
// missing signature under PR #40).
export function validateSurveyUpdate(body: unknown, id: string): ValidationFailure | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_BODY', message: 'request body must be a JSON object' };
  }
  const record = body as Record<string, any>;
  if (record.surveyConfig?.id !== id) {
    return {
      error: 'SURVEY_ID_MISMATCH',
      message: 'surveyConfig.id must match the survey id in the URL',
    };
  }
  return validateBody(record, {
    signature: { required: true, type: 'string' }, // #40 superset
    userAddress: { required: true, type: 'string' }, // #40 superset
    survey: { required: true, type: 'object' },
    poolConfig: { required: true, type: 'object' },
  });
}

// POST /api/surveys/:id/score — needs signature/signer for the on-chain auth
// check and poolId for the isPoolMember read. All three are required strings.
export function validateScore(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    signature: { required: true, type: 'string' },
    signer: { required: true, type: 'string' },
    poolId: { required: true, type: 'string' },
  });
}

// POST /api/surveys/:id/results — needs poolId + poolConfig.safe + auth +
// the queryIds list (body.survey). Only `safe` is required from the pool config.
// #40 superset: auth must carry signature + userAddress (verifySignature authObject).
export function validateResults(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    auth: {
      required: true,
      type: 'object',
      fields: {
        signature: { required: true, type: 'string' }, // #40 superset
        userAddress: { required: true, type: 'string' }, // #40 superset
      },
    },
    survey: { required: true, type: 'array' },
    poolId: { required: true, type: 'string' },
    poolConfig: {
      required: true,
      type: 'object',
      fields: {
        safe: { required: true, type: 'string' },
      },
    },
  });
}

// POST /api/surveys/:surveyId/delegation — needs poolConfig.safe / pkpId / pkpDid
// for the PKP write delegation, plus userDid/signature/userAddress/poolId.
export function validateDelegation(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    userDid: { required: true, type: 'string' },
    signature: { required: true, type: 'string' },
    userAddress: { required: true, type: 'string' },
    poolId: { required: true, type: 'string' },
    poolConfig: {
      required: true,
      type: 'object',
      fields: {
        safe: { required: true, type: 'string' },
        pkpId: { required: true, type: 'string' },
        pkpDid: { required: true, type: 'string' },
      },
    },
  });
}

// POST /api/builder/register — needs the full builder identity
// (signature/userAddress/poolId/pkpId/pkpDid/safeAddress).
export function validateRegisterBuilder(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    signature: { required: true, type: 'string' },
    userAddress: { required: true, type: 'string' },
    poolId: { required: true, type: 'string' },
    pkpId: { required: true, type: 'string' },
    pkpDid: { required: true, type: 'string' },
    safeAddress: { required: true, type: 'string' },
  });
}

// POST /api/lit/usage-key — needs userAddr + signature + poolId.
export function validateUsageKey(body: unknown): ValidationFailure | null {
  return validateBody(body, {
    userAddr: { required: true, type: 'string' },
    signature: { required: true, type: 'string' },
    poolId: { required: true, type: 'string' },
  });
}

// ====== FE producer consumption helpers ======
// The frontends validate the payload they are ABOUT to send, then throw before
// the fetch() on failure (fail-fast at the producer boundary).

/** Thrown by throwOnFailure(); `.error` carries the backend error code. */
export class NillccValidationError extends Error {
  readonly error: string;
  constructor(failure: ValidationFailure) {
    super(failure.message);
    this.name = 'NillccValidationError';
    this.error = failure.error;
  }
}

/** Throw if `failure` is non-null (call on the result of any validate*). */
export function throwOnFailure(failure: ValidationFailure | null): void {
  if (failure) throw new NillccValidationError(failure);
}

// ====== FE producer wire-format types ======
// The exact serialized shapes the frontends send. Extra fields are allowed
// (surveys carry groups/batches, pool configs carry chainId/litNetwork/...);
// these types capture the fields the backend boundary requires.

export interface CreatePoolPayload {
  signature: string;
  userAddress: string;
  poolId: string;
  safeAddress: string;
}

export interface RegisterBuilderPayload {
  signature: string;
  userAddress: string;
  poolId: string;
  pkpId: string;
  pkpDid: string;
  safeAddress: string;
}

export interface SurveyConfigLite {
  id: string;
  pool: string;
  [k: string]: unknown;
}

export interface PoolConfigLite {
  pkpId: string;
  pkpDid: string;
  safe: string;
  [k: string]: unknown;
}

export interface CreateSurveyPayload {
  signature: string;
  userAddress: string;
  surveyConfig: SurveyConfigLite;
  poolConfig: PoolConfigLite;
}

export interface ResultsPayload {
  auth: { signature: string; userAddress: string; [k: string]: unknown };
  survey: unknown[];
  poolId: string;
  poolConfig: { safe: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface UpdateSurveyPayload {
  signature: string;
  userAddress: string;
  survey: Record<string, unknown>;
  poolConfig: Record<string, unknown>;
  surveyConfig: { id: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface DelegationPayload {
  userDid: string;
  signature: string;
  userAddress: string;
  poolId: string;
  poolConfig: { safe: string; pkpId: string; pkpDid: string; [k: string]: unknown };
}

export interface ScorePayload {
  signature: string;
  signer: string;
  poolId: string;
}

export interface UsageKeyPayload {
  userAddr: string;
  signature: string;
  poolId: string;
}
