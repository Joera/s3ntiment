import { Survey } from "@s3ntiment/shared";
// Map aliases are canonical in @s3ntiment/shared (single declaration site — see
// the type-drift consolidation PR); re-exported here so organiser modules can
// keep importing maps from the local state types module without re-declaring.
export type { SurveysMap, PoolsMap, BatchesMap } from "@s3ntiment/shared";

export interface DraftMeta {
  config: Survey;
  createdAt: number;
  updatedAt: number;
}

export interface DraftsMap {
  [id: string]: DraftMeta;
}

export interface UIState {
  landingStep: 'welcome' | 'register' | 'choice';
  newStep: 'intro' | 'questions' | 'batches' | 'creating-pool' | 'register-pool' | 'creating-survey' | 'creating-invites' | 'submitting-tx' | 'error';
  resultTab: 'spinner' | 'results' | 'access' | 'questions' | 'batches';
  batchTab: 'qr-codes' | 'ipfs' | 'urls';
}

export interface AppState {
  ui: UIState;
  surveys: Survey[];
  surveyDraft: Survey;
  currentDraftId: string | null;
}