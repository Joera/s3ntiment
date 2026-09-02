// ====== BOUNDARY VALIDATION ======
//
// Hand-rolled, dependency-free request validation for the mutating Express
// routes. Each validator inspects the raw request body at the route boundary
// and returns a `ValidationFailure` ({ error, message }) BEFORE any side
// effect (service call, Lit/NilDB/IPFS/chain access, store write) runs.
// Returning `null` means the payload is acceptable and the route proceeds.
//
// Style notes:
//   - No zod/ajv — plain functions + a tiny declarative field walker, matching
//     the ad-hoc guard style already used in the codebase (e.g. pool.ctrlr
//     "missing poolId", survey.ctrlr MISSING_POOL_CONFIG).
//   - Codes follow the existing SCREAMING_SNAKE convention (MISSING_POOL_CONFIG,
//     SURVEY_ID_MISMATCH, MISSING_SIGNATURE, ...).
//   - Pool config is treated as OPTIONAL-by-default (PR #38): validators never
//     demand the full PoolConfig shape (safe/chainId/litNetwork/pkpId/pkpDid/
//     groupId). The survey-CREATE path keeps requiring poolConfig.pkpId /
//     pkpDid / safe — that guard is the single enforcement point for minted
//     pool identity. Routes that genuinely need specific config fields for the
//     operation they perform (results -> safe, delegation -> safe+pkpId+pkpDid)
//     require exactly those fields, nothing more.

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

//
// Each route declares its boundary schema as an exported const. The consts are
// the single source of truth for BOTH the validator behavior AND the
// conformance pin: shared/src/shared/nillcc/inputs.ts defines the same
// contracts in zod, and nillcc-backend/src/conformance.test.ts asserts that
// requiredFieldPaths(schemaConst) === zodRequiredFieldPaths(zodSchema) so the
// backend (still zero-dep, hand-rolled) and the producer-side zod validation
// can never drift.
//

// POST /api/pools — PoolController.create({ signature, userAddress, poolId, safeAddress })
// poolId / safeAddress keep their historical "missing poolId" / "missing safeAddress"
// messages (previously returned as bare strings by the controller guard).
export const POOL_CREATE_SCHEMA: ValidationSchema = {
  signature: { required: true, type: 'string' },
  userAddress: { required: true, type: 'string' },
  poolId: { required: true, type: 'string', requiredMessage: 'missing poolId' },
  safeAddress: { required: true, type: 'string', requiredMessage: 'missing safeAddress' },
};

export function validatePoolCreate(body: unknown): ValidationFailure | null {
  return validateBody(body, POOL_CREATE_SCHEMA);
}

// POST /api/surveys — SurveyController.create({ signature, userAddress, surveyConfig, poolConfig })
// poolConfig must carry pkpId / pkpDid / safe — this is the canonical enforcement
// point for minted pool identity (see survey.ctrlr MISSING_POOL_CONFIG guard,
// preserved verbatim here as a boundary 400 instead of a thrown 500).
export const SURVEY_CREATE_SCHEMA: ValidationSchema = {
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
  poolConfig: {
    required: true,
    type: 'object',
    requiredMessage: 'create-survey payload requires poolConfig with pkpId, pkpDid and safe',
    fields: {
      pkpId: { required: true, type: 'string' },
      pkpDid: { required: true, type: 'string' },
      safe: { required: true, type: 'string' },
    },
  },
};

// Top-level + surveyConfig are validated through the shared schema const; the
// pool-identity fields are enforced by the explicit guard below so the
// historical MISSING_POOL_CONFIG code + message survive unchanged.
const SURVEY_CREATE_BASE: ValidationSchema = {
  signature: SURVEY_CREATE_SCHEMA.signature,
  userAddress: SURVEY_CREATE_SCHEMA.userAddress,
  surveyConfig: SURVEY_CREATE_SCHEMA.surveyConfig,
};

export function validateSurveyCreate(body: unknown): ValidationFailure | null {
  const base = validateBody(body, SURVEY_CREATE_BASE);
  if (base) return base;

  // Pool identity is the single enforcement point: mirror the survey.ctrlr
  // guard exactly — absent OR partial poolConfig is a MISSING_POOL_CONFIG.
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
// Preserves the SURVEY_ID_MISMATCH guard (URL id vs body.surveyConfig.id) and its
// error code. `survey` and `poolConfig` must be objects, but per PR #38 the
// pool config fields are NOT required here — the update path is not the pool
// identity enforcement point. `surveyConfig.id` is listed so the conformance
// pin reflects the URL-id match requirement (enforced by the guard below).
export const SURVEY_UPDATE_SCHEMA: ValidationSchema = {
  survey: { required: true, type: 'object' },
  poolConfig: { required: true, type: 'object' },
  surveyConfig: {
    required: true,
    type: 'object',
    fields: {
      id: { required: true, type: 'string' },
    },
  },
};

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
  return validateBody(record, SURVEY_UPDATE_SCHEMA);
}

// POST /api/surveys/:id/score — needs signature/signer for on-chain auth check
// and poolId for the isPoolMember read. All three are required strings.
export const SCORE_SCHEMA: ValidationSchema = {
  signature: { required: true, type: 'string' },
  signer: { required: true, type: 'string' },
  poolId: { required: true, type: 'string' },
};

export function validateScore(body: unknown): ValidationFailure | null {
  return validateBody(body, SCORE_SCHEMA);
}

// POST /api/surveys/:id/results — needs poolId + poolConfig.safe (PKP safe used
// for the owner invocations) + auth + the queryIds list (body.survey). Only
// `safe` is required from the pool config — not a full PoolConfig.
export const RESULTS_SCHEMA: ValidationSchema = {
  auth: { required: true, type: 'object' },
  survey: { required: true, type: 'array' },
  poolId: { required: true, type: 'string' },
  poolConfig: {
    required: true,
    type: 'object',
    fields: {
      safe: { required: true, type: 'string' },
    },
  },
};

export function validateResults(body: unknown): ValidationFailure | null {
  return validateBody(body, RESULTS_SCHEMA);
}

// POST /api/surveys/:surveyId/delegation — SurveyController.getUserDelegation
// uses poolConfig.safe / pkpId / pkpDid for the PKP write delegation, so those
// three are required here (still not a full PoolConfig).
export const DELEGATION_SCHEMA: ValidationSchema = {
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
};

export function validateDelegation(body: unknown): ValidationFailure | null {
  return validateBody(body, DELEGATION_SCHEMA);
}

// POST /api/builder/register — PoolController.registerBuilder needs the full
// builder identity (signature/userAddress/poolId/pkpId/pkpDid/safeAddress).
export const REGISTER_BUILDER_SCHEMA: ValidationSchema = {
  signature: { required: true, type: 'string' },
  userAddress: { required: true, type: 'string' },
  poolId: { required: true, type: 'string' },
  pkpId: { required: true, type: 'string' },
  pkpDid: { required: true, type: 'string' },
  safeAddress: { required: true, type: 'string' },
};

export function validateRegisterBuilder(body: unknown): ValidationFailure | null {
  return validateBody(body, REGISTER_BUILDER_SCHEMA);
}

// POST /api/lit/usage-key — needs userAddr + signature for the on-chain
// signature check and poolId for the key lookup.
export const USAGE_KEY_SCHEMA: ValidationSchema = {
  userAddr: { required: true, type: 'string' },
  signature: { required: true, type: 'string' },
  poolId: { required: true, type: 'string' },
};

export function validateUsageKey(body: unknown): ValidationFailure | null {
  return validateBody(body, USAGE_KEY_SCHEMA);
}

// ====== Conformance helper ======
//
// Walk a declarative FieldRule schema and return the dotted path of every field
// that is required (recursing into nested object fields). Mirrors the zod
// walker in shared/src/shared/nillcc/inputs.ts (zodRequiredFieldPaths): an
// object with no required nested fields counts as a leaf at its own path, so
// both walkers produce identical listings for the same contract.
//
export function requiredFieldPaths(schema: ValidationSchema, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, rule] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!rule.required) continue;
    if (rule.fields) {
      const nested = requiredFieldPaths(rule.fields, path);
      if (nested.length > 0) paths.push(...nested);
      else paths.push(path);
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}
