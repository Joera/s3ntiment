import { DraftsMap, PoolsMap, BatchesMap, SurveysMap } from './types.js';

const DRAFTS_STORAGE_KEY = 'surveyDrafts';
const CURRENT_DRAFT_KEY = 'currentDraftId';
const CAP_DELEGATION_KEY = 'litCapabilityDelegation';
const SURVEYS_STORAGE_KEY = 'surveys';
const POOLS_STORAGE_KEY = 'pools';
const BATCHES_STORAGE_KEY = 'batches';

export function loadSurveysFromStorage(): SurveysMap {
  try {
    const stored = localStorage.getItem(SURVEYS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Failed to load surveys from localStorage:', e);
  }
  return {};
}

export function saveSurveysToStorage(surveys: SurveysMap): void {
  try {
    localStorage.setItem(SURVEYS_STORAGE_KEY, JSON.stringify(surveys));
  } catch (e) {
    console.warn('Failed to save surveys to localStorage:', e);
  }
}

export function loadPoolsFromStorage(): PoolsMap {
  try {
    const stored = localStorage.getItem(POOLS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Failed to load pools from localStorage:', e);
  }
  return {};
}

export function savePoolsToStorage(surveys: PoolsMap): void {
  try {
    localStorage.setItem(POOLS_STORAGE_KEY, JSON.stringify(surveys));
  } catch (e) {
    console.warn('Failed to save pools to localStorage:', e);
  }
}

export function loadBatchesFromStorage(): BatchesMap {
  try {
    const stored = localStorage.getItem(BATCHES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Failed to load bacthes from localStorage:', e);
  }
  return {};
}

export function saveBatchesToStorage(surveys: BatchesMap): void {
  try {
    localStorage.setItem(BATCHES_STORAGE_KEY, JSON.stringify(surveys));
  } catch (e) {
    console.warn('Failed to save batches to localStorage:', e);
  }
}


export function loadDraftsFromStorage(): DraftsMap {
  try {
    const stored = localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load survey drafts from localStorage:', e);
  }
  return {};
}

export function saveDraftsToStorage(drafts: DraftsMap): void {
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch (e) {
    console.warn('Failed to save survey drafts to localStorage:', e);
  }
}

export function loadCurrentDraftId(): string | null {
  try {
    return localStorage.getItem(CURRENT_DRAFT_KEY);
  } catch (e) {
    return null;
  }
}

export function saveCurrentDraftId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(CURRENT_DRAFT_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_DRAFT_KEY);
    }
  } catch (e) {
    console.warn('Failed to save current draft id:', e);
  }
}

export function saveCapabilityDelegation(delegation: any): void {
  try {
    localStorage.setItem(CAP_DELEGATION_KEY, JSON.stringify(delegation));
  } catch (e) {
    console.warn('Failed to save capability delegation:', e);
  }
}

export function loadCapabilityDelegation(): any | null {
  try {
    const stored = localStorage.getItem(CAP_DELEGATION_KEY);
    if (!stored) return null;
    const delegation = JSON.parse(stored);
    if (isDelegationExpired(delegation)) {
      localStorage.removeItem(CAP_DELEGATION_KEY);
      return null;
    }
    return delegation;
  } catch (e) {
    return null;
  }
}

function isDelegationExpired(delegation: any): boolean {
  try {
    const match = delegation.signedMessage.match(/Expiration Time: (.+)/);
    if (!match) return true;
    return new Date(match[1].trim()) < new Date();
  } catch {
    return true;
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}