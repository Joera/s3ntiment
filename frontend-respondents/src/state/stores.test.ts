import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable } from './observable.js';
import { PoolStore } from './pool.store.js';
import { UserStore } from './user.store.js';
import { SurveysStore } from './surveys.store.js';
import {
  slugify,
  loadPoolsFromStorage,
  savePoolsToStorage,
  loadUserFromStorage,
  saveUserToStorage,
  clearBootstrapKey,
  loadDerivedSKeyFromStorage,
  saveDerivedSKeyFromStorage,
  loadAnchorAddressFromStorage,
  saveAnchorAddressFromStorage,
} from './storage.js';
import type { Pool } from '@s3ntiment/shared';

// ---- Fixtures ---------------------------------------------------------------

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    id: 'pool-1',
    name: 'Exhibition Cohort',
    safeAddress: '0x00000000000000000000000000000000000000aa',
    batches: ['b1'],
    createdAt: 1724800000,
    config: { pkpId: '0xpkp1', pkpDid: 'did:pkp:1' },
    ...overrides,
  };
}

const POOL_A = makePool();
const POOL_B = makePool({
  id: 'pool-2',
  name: 'Members Cohort',
  safeAddress: '0x00000000000000000000000000000000000000bb',
});

// -----------------------------------------------------------------------------

describe('Observable — subscribe / notify semantics', () => {
  it('get() returns the initial value and set() replaces it', () => {
    const obs = new Observable<number>(1);
    expect(obs.get()).toBe(1);
    obs.set(2);
    expect(obs.get()).toBe(2);
  });

  it('update() derives the next value from the current one', () => {
    const obs = new Observable<{ n: number }>({ n: 1 });
    obs.update((c) => ({ n: c.n + 1 }));
    expect(obs.get()).toEqual({ n: 2 });
  });

  it('notifies every subscribed listener with the new value on set', () => {
    const obs = new Observable<string>('a');
    const l1 = vi.fn();
    const l2 = vi.fn();
    obs.subscribe(l1);
    obs.subscribe(l2);

    obs.set('b');

    expect(l1).toHaveBeenCalledOnce();
    expect(l1).toHaveBeenCalledWith('b');
    expect(l2).toHaveBeenCalledWith('b');
  });

  it('does not call listeners on subscribe(); only on mutations', () => {
    const obs = new Observable<number>(0);
    const listener = vi.fn();
    obs.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    obs.update((n) => n + 1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('the unsubscribe fn returned by subscribe() stops further notifications', () => {
    const obs = new Observable<number>(0);
    const listener = vi.fn();
    const unsubscribe = obs.subscribe(listener);

    obs.set(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    obs.set(2);
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribe

    // A listener removed once is truly gone — re-subscribing yields a second slot.
    const l2 = vi.fn();
    obs.subscribe(l2);
    obs.set(3);
    expect(l2).toHaveBeenCalledTimes(1);
  });
});

describe('storage.slugify', () => {
  it('lower-cases and trims surrounding whitespace', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
  });

  it('strips non-word characters (punctuation/symbols)', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('collapses whitespace, underscores and hyphens into a single hyphen', () => {
    expect(slugify('a  b_c--d')).toBe('a-b-c-d');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello world--')).toBe('hello-world');
  });

  it('is a no-op for an already-slug-clean string', () => {
    expect(slugify('already-clean')).toBe('already-clean');
  });

  it('handles a fully-punctuated string without producing a lone hyphen', () => {
    expect(slugify('!!! @@@ ###')).toBe('');
  });
});

describe('PoolStore — add / remove / set / get', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it('starts empty when storage holds no pools', () => {
    const ps = new PoolStore();
    expect(ps.all).toEqual([]);
    expect(ps.get('pool-1')).toBeUndefined();
  });

  it('loads existing pools from storage into a fresh instance', () => {
    savePoolsToStorage({ [POOL_A.id]: POOL_A });
    const ps = new PoolStore();
    expect(ps.all).toEqual([POOL_A]);
  });

  it('add() appends a new pool and persists it to storage', () => {
    const ps = new PoolStore();
    ps.add(POOL_A);

    expect(ps.get('pool-1')).toEqual(POOL_A);
    // the observable subscriber wrote the pool map back to localStorage
    expect(loadPoolsFromStorage()['pool-1']).toEqual(POOL_A);
  });

  it('add() replaces an existing pool with the same id instead of duplicating', () => {
    const ps = new PoolStore();
    ps.add(POOL_A);
    const renamed = makePool({ name: 'Renamed Cohort' });
    ps.add(renamed);

    expect(ps.all).toHaveLength(1);
    expect(ps.get('pool-1')?.name).toBe('Renamed Cohort');
  });

  it('add() notifies subscribers and set() replaces the entire list', () => {
    const ps = new PoolStore();
    const listener = vi.fn();
    ps.subscribe(listener);

    ps.add(POOL_A);
    expect(listener).toHaveBeenCalledTimes(1);

    ps.set([POOL_B]);
    expect(ps.all).toEqual([POOL_B]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('remove() drops a pool by id and persists the result', () => {
    const ps = new PoolStore();
    ps.set([POOL_A, POOL_B]);
    ps.remove('pool-1');

    expect(ps.get('pool-1')).toBeUndefined();
    expect(ps.all).toEqual([POOL_B]);
    expect(loadPoolsFromStorage()['pool-1']).toBeUndefined();
  });

  it('remove() of an unknown id is a no-op that leaves the list unchanged', () => {
    const ps = new PoolStore();
    ps.set([POOL_A]);
    ps.remove('does-not-exist');

    expect(ps.all).toEqual([POOL_A]);
  });

  it('clear() empties the store and removes the storage key entry', () => {
    const ps = new PoolStore();
    ps.set([POOL_A]);
    ps.clear();

    expect(ps.all).toEqual([]);
    expect(loadPoolsFromStorage()).toEqual({});
  });
});

describe('UserStore — set / persist / clear', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it('starts from stored user data when present', () => {
    saveUserToStorage({ nullifier: 'n1', batchId: 'b1', address: '0xaa' });
    const us = new UserStore();
    expect(us.state).toEqual({ nullifier: 'n1', batchId: 'b1', address: '0xaa' });
    expect(us.nullifier).toBe('n1');
    expect(us.batchId).toBe('b1');
    expect(us.address).toBe('0xaa');
  });

  it('starts with all-null user when storage is empty', () => {
    const us = new UserStore();
    expect(us.state).toEqual({ nullifier: null, batchId: null, address: null });
  });

  it('set() merges a partial update into the current state', () => {
    const us = new UserStore();
    us.set({ nullifier: 'n1' });
    expect(us.state).toEqual({ nullifier: 'n1', batchId: null, address: null });

    us.set({ batchId: 'b2', address: '0xcc' });
    expect(us.state).toEqual({ nullifier: 'n1', batchId: 'b2', address: '0xcc' });
  });

  it('set() with an empty update is a value no-op (state values unchanged)', () => {
    const us = new UserStore();
    us.set({ nullifier: 'n1' });
    const before = us.state;

    us.set({});
    expect(us.state).toEqual(before); // same values, nothing clobbered
  });

  it('notifies subscribers on set()', () => {
    const us = new UserStore();
    const l = vi.fn();
    us.subscribe(l);
    us.set({ address: '0xdd' });
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('persist() writes the current state to storage', () => {
    const us = new UserStore();
    us.set({ nullifier: 'n9', batchId: 'b9', address: '0x99' });
    us.persist();

    expect(loadUserFromStorage()).toEqual({
      nullifier: 'n9',
      batchId: 'b9',
      address: '0x99',
    });
  });

  it('clear() resets state to nulls and clears the persisted user', () => {
    const us = new UserStore();
    us.set({ nullifier: 'n1', batchId: 'b1', address: '0xaa' });
    us.persist();

    us.clear();

    expect(us.state).toEqual({ nullifier: null, batchId: null, address: null });
    expect(loadUserFromStorage()).toEqual({
      nullifier: null,
      batchId: null,
      address: null,
    });
  });
});

describe('SurveysStore.clear(surveyId)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it('clear(surveyId) removes only that survey and persists the rest', () => {
    const ss = new SurveysStore();
    ss.setData('s1', { id: 's1', pool: 'pool-1' } as any);
    ss.setData('s2', { id: 's2', pool: 'pool-2' } as any);

    ss.clear('s1');

    expect(ss.getData('s1')).toBeNull();
    expect(ss.getData('s2')).not.toBeNull();
  });

  it('clear(surveyId) on an unknown id is a no-op that keeps all surveys', () => {
    const ss = new SurveysStore();
    ss.setData('s1', { id: 's1', pool: 'pool-1' } as any);

    const before = { ...ss.all };
    ss.clear('does-not-exist');

    expect(ss.getData('s1')).not.toBeNull();
    expect(ss.all).toEqual(before);
  });

  it('clear() with no argument empties all surveys, resets active id and clears storage', () => {
    const ss = new SurveysStore();
    ss.setData('s1', { id: 's1', pool: 'pool-1' } as any);
    ss.setActive('s1');
    expect(ss.activeSurveyId).toBe('s1');

    ss.clear();

    expect(ss.all).toEqual({});
    expect(ss.activeSurveyId).toBeNull();
    expect(ss.active).toBeNull();
    expect((globalThis as any).localStorage.getItem('surveys')).toBeNull();
  });
});

describe('Stealth-account storage helpers (anchor_address / derived S / clear-bootstrap)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('adds derived-S write/read helpers keyed to DERIVED_S_STORAGE_KEY', () => {
    const ls = (globalThis as any).localStorage;
    expect(ls.getItem('derivedS')).toBeNull();

    saveDerivedSKeyFromStorage('0x1111111111111111111111111111111111111111111111111111111111111111');
    expect(loadDerivedSKeyFromStorage()).toBe(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    expect(ls.getItem('derivedS')).toBe(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
  });

  it('rejects a malformed (non-64-hex) derived-S value, returning null', () => {
    saveDerivedSKeyFromStorage('0x1234');
    expect(loadDerivedSKeyFromStorage()).toBeNull();

    saveDerivedSKeyFromStorage('not-a-key');
    expect(loadDerivedSKeyFromStorage()).toBeNull();
  });

  it('anchor_address is undefined when absent and round-trips when saved', () => {
    const ls = (globalThis as any).localStorage;
    expect(loadAnchorAddressFromStorage()).toBeUndefined();

    saveAnchorAddressFromStorage('you@example.com');
    expect(loadAnchorAddressFromStorage()).toBe('you@example.com');
    expect(ls.getItem('anchor_address')).toBe('you@example.com');
  });

  it('clearBootstrapKey wipes bootstrapE (N1 wipe) and leaves derived-S intact', () => {
    const ls = (globalThis as any).localStorage;
    const BOOTSTRAP_KEY = 'bootstrapE';
    ls.setItem(BOOTSTRAP_KEY, '0x2222222222222222222222222222222222222222222222222222222222222222');
    ls.setItem('derivedS', '0x3333333333333333333333333333333333333333333333333333333333333333');

    clearBootstrapKey();

    expect(ls.getItem(BOOTSTRAP_KEY)).toBeNull();
    expect(ls.getItem('derivedS')).not.toBeNull();
    // the derived-S helper still reads the kept value
    expect(loadDerivedSKeyFromStorage()).toBe(
      '0x3333333333333333333333333333333333333333333333333333333333333333',
    );
  });
});
