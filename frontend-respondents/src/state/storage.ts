import { Pool } from "@s3ntiment/shared";
import { UserState } from "./store.types";
import { SurveyMap } from "./surveys.store";

// const CAP_DELEGATION_KEY = 'litCapabilityDelegation';
const SURVEYS_STORAGE_KEY = 'surveys';
const POOLS_STORAGE_KEY = 'pools';

// Bootstrap stealth-leaf private key (RFC-deferred-identity-persistence).
// The random bootstrap leaf `E` is written to device-local storage IMMEDIATELY at
// generation (RFC §7.1) so it survives a tab close — otherwise the burned nullifier
// is orphaned. This is the transient bootstrap credential, NOT a durable anchor.
export const BOOTSTRAP_STORAGE_KEY = 'bootstrapE';

export function loadBootstrapKeyFromStorage(): `0x${string}` | null {
  try {
    const stored = localStorage.getItem(BOOTSTRAP_STORAGE_KEY);
    // Persisted as raw 0x-prefixed 32-byte (64 hex char) private key.
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) {
      return stored as `0x${string}`;
    }
  } catch (e) {
    console.warn('Failed to load bootstrap key from localStorage:', e);
  }
  return null;
}

export function saveBootstrapKeyToStorage(key: `0x${string}`): void {
  try {
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, key);
  } catch (e) {
    console.warn('Failed to save bootstrap key to localStorage:', e);
  }
}

export interface PoolsMap {
  [id: string]: Pool;
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


export function loadUserFromStorage(): UserState {
  return {
    nullifier: localStorage.getItem('nullifier'),
    batchId:   localStorage.getItem('batchId'),
    address:   localStorage.getItem('address'),
  };
}

export function saveUserToStorage(state: Partial<UserState>): void {
  try {
    if (state.nullifier) localStorage.setItem('nullifier', state.nullifier);
    if (state.batchId)   localStorage.setItem('batchId', state.batchId);
    if (state.address)   localStorage.setItem('address', state.address);
  } catch (e) {
    console.warn('Failed to save user state to localStorage:', e);
  }
}

export function clearUserFromStorage(): void {
  localStorage.removeItem('nullifier');
  localStorage.removeItem('batchId');
  localStorage.removeItem('address');
}

export function loadSurveysFromStorage(): SurveyMap {
  try {
    const stored = localStorage.getItem(SURVEYS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.warn('Failed to load surveys from localStorage:', e);
    return {};
  }
}

export function saveSurveysToStorage(surveys: SurveyMap): void {
  try {
    localStorage.setItem(SURVEYS_STORAGE_KEY, JSON.stringify(surveys));
  } catch (e) {
    console.warn('Failed to save surveys to localStorage:', e);
  }
}

export function clearSurveysFromStorage(): void {
  localStorage.removeItem(SURVEYS_STORAGE_KEY);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}