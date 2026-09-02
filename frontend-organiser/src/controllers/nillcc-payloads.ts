// ============================================================================
// nillcc payload builders — the single place the organiser FE shapes the JSON
// body for every mutating nillcc-backend route.
//
// Each builder returns EXACTLY the body the backend's route-boundary validator
// accepts (see nillcc-backend/src/validation.ts and the shared zod contracts
// in @s3ntiment/shared/nillcc). The controllers feed the result through
// validateXxxInput BEFORE the fetch round-trip (fast-fail), and the test suite
// (nillcc-payloads.test.ts) feeds real builder output into the real zod
// schemas — so producer/consumer drift is caught in tests, not production.
//
// These builders are dependency-free pure functions (no DOM, no services, no
// shared-barrel import) so they are trivially unit-testable.
// ============================================================================

export interface SignatureIdentity {
  signature: string;
  userAddress: string;
}

// --- POST /api/pools ---------------------------------------------------------

export interface PoolCreatePayload extends SignatureIdentity {
  poolId: string;
  safeAddress: string;
}

export function buildPoolCreatePayload(args: {
  signature: string;
  userAddress: string;
  poolId: string;
  safeAddress: string;
}): PoolCreatePayload {
  return {
    signature: args.signature,
    userAddress: args.userAddress,
    poolId: args.poolId,
    safeAddress: args.safeAddress,
  };
}

// --- POST /api/builder/register ---------------------------------------------

export interface RegisterBuilderPayload extends SignatureIdentity {
  poolId: string;
  pkpId: string;
  pkpDid: string;
  safeAddress: string;
}

export function buildRegisterBuilderPayload(args: {
  signature: string;
  userAddress: string;
  poolId: string;
  pkpId: string;
  pkpDid: string;
  safeAddress: string;
}): RegisterBuilderPayload {
  return {
    signature: args.signature,
    userAddress: args.userAddress,
    poolId: args.poolId,
    pkpId: args.pkpId,
    pkpDid: args.pkpDid,
    safeAddress: args.safeAddress,
  };
}

// --- POST /api/surveys -------------------------------------------------------

export interface SurveyConfigPayload {
  id?: string;
  pool?: string;
  title?: string;
  introduction?: string;
  groups?: unknown[];
  batches?: unknown[];
  [key: string]: unknown;
}

export interface PoolConfigPayload {
  safe?: string;
  chainId?: number;
  litNetwork?: string;
  pkpId?: string;
  pkpDid?: string;
  groupId?: string;
  [key: string]: unknown;
}

export interface SurveyCreatePayload extends SignatureIdentity {
  surveyConfig: SurveyConfigPayload;
  poolConfig: PoolConfigPayload;
}

export function buildSurveyCreatePayload(args: {
  signature: string;
  userAddress: string;
  surveyConfig: SurveyConfigPayload;
  poolConfig: PoolConfigPayload | undefined;
}): SurveyCreatePayload {
  return {
    signature: args.signature,
    userAddress: args.userAddress,
    surveyConfig: args.surveyConfig,
    // A missing pool config is a producer bug: the zod validator (and the
    // backend boundary) will fast-fail on it rather than sending undefined.
    poolConfig: args.poolConfig ?? ({} as PoolConfigPayload),
  };
}

// --- POST /api/surveys/:id/results ------------------------------------------
// NOTE: the backend names the query-ids array `survey` (it is validated as a
// required array). The FE UI historically called this `queryIds` — the builder
// maps it onto the wire name so the POST is accepted.

export interface ResultsPayload {
  auth: SignatureIdentity;
  survey: string[];
  poolId: string;
  groups: unknown[];
  poolConfig: PoolConfigPayload;
}

export function buildResultsPayload(args: {
  auth: SignatureIdentity;
  queryIds: string[];
  poolId: string;
  groups: unknown[];
  poolConfig: PoolConfigPayload | undefined;
}): ResultsPayload {
  return {
    auth: args.auth,
    survey: args.queryIds,
    poolId: args.poolId,
    groups: args.groups ?? [],
    poolConfig: args.poolConfig ?? ({} as PoolConfigPayload),
  };
}

// --- PUT /api/surveys/:id ----------------------------------------------------
// NOTE: the backend requires `survey`, `poolConfig` and `surveyConfig.id` (the
// URL id). The FE historically sent `{ surveyId, surveyConfig, safeAddress,
// poolId }` which the boundary validator rejected. The builder reshapes onto
// the accepted wire contract.

export interface SurveyUpdatePayload {
  survey: SurveyConfigPayload;
  poolConfig: PoolConfigPayload;
  surveyConfig: { id: string };
}

export function buildSurveyUpdatePayload(args: {
  surveyId: string;
  surveyConfig: SurveyConfigPayload;
  poolConfig: PoolConfigPayload | undefined;
}): SurveyUpdatePayload {
  return {
    survey: args.surveyConfig,
    poolConfig: args.poolConfig ?? ({} as PoolConfigPayload),
    surveyConfig: { id: args.surveyId },
  };
}
