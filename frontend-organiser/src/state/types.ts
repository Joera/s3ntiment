import { Batch, Pool, Survey } from "@s3ntiment/shared";

export interface DraftMeta {
  config: Survey;
  createdAt: number;
  updatedAt: number;
}

export interface DraftsMap {
  [id: string]: DraftMeta;
}

export interface SurveysMap {
  [id: string]: Survey;
}

export interface PoolsMap {
  [id: string]: Pool;
}

export interface BatchesMap {
  [id: string]: Batch;
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