// NillCC route-boundary conformance module — the single source of truth for the
// request/response contracts between the organiser frontend and the nillcc
// backend. Backend boundary validation (nillcc-backend/src/validation.ts) is
// hand-rolled and zero-dep; this zod module is canonical and the conformance
// test pins the two together.

export * from './inputs.js';
export * from './outputs.js';
