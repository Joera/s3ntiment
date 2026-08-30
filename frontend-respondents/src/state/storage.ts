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

// Derived leaf `S` private key (RFC-deferred-identity-persistence §8.2 / §9.4).
// Written to device-local storage AFTER a successful E→S rotate (secure step). A
// random bootstrap `E` is transient; `S` is the durable derived leaf the anchor
// deterministically reproduces, and keeping it on-device enables silent same-
// device recovery (Case 1) without re-auth. Decision (locked): keep it persisted;
// no removal / no encryption-at-rest. Mirrors the validated 64-hex pattern of
// `BOOTSTRAP_STORAGE_KEY` (user-accepted device-readability, RFC §9.4).
export const DERIVED_S_STORAGE_KEY = 'derivedS';

// Anchor-address flag (single source of truth for "has this device secured").
// A string (human-wallet identifier, e.g. email); `undefined` === not secured, so
// the results-page CTA is shown iff `loadAnchorAddressFromStorage() === undefined`
// (RFC §9.2: `anchor_address === undefined` drives the CTA). Written ONLY once the
// full E→S rotate (register → migrate → wipe) succeeds — RFC §9.2 / N1. It is a
// "this device secured" flag, NOT recovery material (it never holds the anchor key,
// so it cannot silently re-derive S).
export const ANCHOR_ADDRESS_STORAGE_KEY = 'anchor_address';

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

// Wipe the transient bootstrap leaf `E` (N1: after a successful E→S rotate we
// discard `E` — Rfc §5.2 step 5 / §9.4). `localStorage.removeItem` is called
// directly (no validation needed for removal) and wrapped in the same
// console.warn-guarded try/catch as the other storage helpers.
export function clearBootstrapKey(): void {
  try {
    localStorage.removeItem(BOOTSTRAP_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear bootstrap key from localStorage:', e);
  }
}

// Derived leaf `S` private key helpers (mirror the validated 64-hex pattern of
// loadBootstrapKeyFromStorage — the derived S key has the same shape).
export function loadDerivedSKeyFromStorage(): `0x${string}` | null {
  try {
    const stored = localStorage.getItem(DERIVED_S_STORAGE_KEY);
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) {
      return stored as `0x${string}`;
    }
  } catch (e) {
    console.warn('Failed to load derived S key from localStorage:', e);
  }
  return null;
}

export function saveDerivedSKeyFromStorage(key: `0x${string}`): void {
  try {
    localStorage.setItem(DERIVED_S_STORAGE_KEY, key);
  } catch (e) {
    console.warn('Failed to save derived S key to localStorage:', e);
  }
}

// Anchor-address flag helpers. Returns `undefined` when not present — the
// single source of truth driving the results-page CTA (`anchor_address ===
// undefined` ⇒ show "secure your stealth account").
export function loadAnchorAddressFromStorage(): string | undefined {
  try {
    const stored = localStorage.getItem(ANCHOR_ADDRESS_STORAGE_KEY);
    return stored ?? undefined;
  } catch (e) {
    console.warn('Failed to load anchor address from localStorage:', e);
    return undefined;
  }
}

export function saveAnchorAddressFromStorage(anchor: string): void {
  try {
    localStorage.setItem(ANCHOR_ADDRESS_STORAGE_KEY, anchor);
  } catch (e) {
    console.warn('Failed to save anchor address to localStorage:', e);
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