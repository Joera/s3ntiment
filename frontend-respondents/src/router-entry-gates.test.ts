import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- The gate helpers are imported AFTER these mocks are hoisted, so the
// helper module resolves against the mocked Card / fetchSurvey / bootstrap fns.
// `Card` is mocked so we control `isUsed` per test (mirrors auth-ctrlr.test's
// instance-capturing mock); `store` is the REAL store (like survey-ctrlr.test
// uses) so we can assert the gate populates survey data. The survey gate no
// longer authenticates — it ensures the random bootstrap leaf `E` (deferred
// identity, Task 1) via the mocked ensureBootstrapKey.

const h = vi.hoisted(() => ({
  isUsedImpl: {
    current: async () => false,
  },
  instances: [] as any[],
  fetchImpl: {
    current: async () => ['ipfs-cid-1', '0x00000000000000000000000000000000000000be', '2026-08-28'],
  },
}));

vi.mock('../../shared/src/shared/invites/card.factory.js', () => ({
  Card: class {
    public data: any;
    public isUsed = vi.fn((...args: any[]) => h.isUsedImpl.current(...args));
    get surveyId() { return this.data.surveyId; }
    get nullifier() { return this.data.nullifier; }
    get batchId() { return this.data.batchId; }
    constructor(data: any) {
      this.data = data;
      h.instances.push(this);
    }
  },
  parseCardURL: vi.fn(),
}));

vi.mock('@s3ntiment/shared/browser', () => ({
  fetchSurvey: vi.fn((...args: any[]) => h.fetchImpl.current(...args)),
}));

vi.mock('./bootstrap.factory.js', () => ({
  ensureBootstrapKey: vi.fn(),
}));

import {
  resolveRootGate,
  resolveSurveyGate,
} from './router.gates.js';
import { Card } from '../../shared/src/shared/invites/card.factory.js';
import { ensureBootstrapKey } from './bootstrap.factory.js';
import { store } from './state/store.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0x00000000000000000000000000000000000000be';
const SURVEY_STORE = { address: '0xaddr', abi: [] };

const CARD_DATA = {
  nullifier: 'resp-1',
  batchId: '0x00000000000000000000000000000000000000ff',
  signature: '0x1234',
  surveyOwner: '0x00000000000000000000000000000000000000ee',
  surveyId: SURVEY_ID,
};

function fakeServices(): any {
  return { account: {}, viem: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.instances.length = 0;
  h.isUsedImpl.current = async () => false;
  h.fetchImpl.current = async () => ['ipfs-cid-1', POOL_ID, '2026-08-28'];
  (ensureBootstrapKey as any).mockResolvedValue('0x00000000000000000000000000000000000000be');
  store.clear();
});

describe('resolveRootGate (root "/" entry gate)', () => {
  it('unparseable card (null cardData) -> navigate /invalid-card', async () => {
    const decision = await resolveRootGate(fakeServices(), null, SURVEY_STORE);
    expect(decision).toEqual({ navigate: '/invalid-card' });
    expect(h.instances.length).toBe(0);
  });

  it('used card -> navigate /used-card/:surveyId', async () => {
    h.isUsedImpl.current = async () => true;
    const decision = await resolveRootGate(fakeServices(), CARD_DATA, SURVEY_STORE);

    expect(decision).toEqual({ navigate: `/used-card/${SURVEY_ID}` });
    // Card built from cardData; isUsed consulted with (services, surveyStore, poolId)
    const card: any = h.instances[0];
    expect(card).toBeDefined();
    expect(card.data).toBe(CARD_DATA);
    // poolId resolved from the survey fetch (root gate can't see the pool on the
    // card URL) before the per-pool isUsed read.
    expect(card.isUsed).toHaveBeenCalledWith(expect.anything(), SURVEY_STORE, POOL_ID);
  });

  it('fresh card -> proceed', async () => {
    const decision = await resolveRootGate(fakeServices(), CARD_DATA, SURVEY_STORE);
    expect(decision).toEqual({ proceed: true });
    expect(h.instances[0].isUsed).toHaveBeenCalledWith(expect.anything(), SURVEY_STORE, POOL_ID);
  });

  it('propagates a rejection from Card.isUsed', async () => {
    h.isUsedImpl.current = async () => {
      throw new Error('used check failed');
    };
    await expect(
      resolveRootGate(fakeServices(), CARD_DATA, SURVEY_STORE),
    ).rejects.toThrow('used check failed');
  });
});

describe('resolveSurveyGate (/surveys/:surveyId entry gate — deferred bootstrap identity)', () => {
  it('missing surveyId -> navigate /surveys (no fetch, no bootstrap)', async () => {
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, '');

    expect(decision).toEqual({ navigate: '/surveys' });
    expect(ensureBootstrapKey).not.toHaveBeenCalled();
  });

  it('proceeds after ensuring the bootstrap leaf, and fetchSurvey populates the store', async () => {
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID);

    expect(decision).toEqual({ proceed: true });
    // deferred identity at entry = ensure the random bootstrap leaf E exists + persisted
    expect(ensureBootstrapKey).toHaveBeenCalledTimes(1);

    // fetchSurvey populates the store via setSurveyData + setActiveSurvey
    expect(store.getSurveyData(SURVEY_ID)).toMatchObject({
      id: SURVEY_ID,
      pool: POOL_ID,
    });
    expect(store.activeSurveyId).toBe(SURVEY_ID);
    expect(store.activeSurvey).toMatchObject({ id: SURVEY_ID });
  });

  it('does NOT gate on on-chain pool membership (E is pre-registration at entry)', async () => {
    // The gate never consults isPoolMember/authenticate — the random leaf is
    // pre-registration, so entry is ensured bootstrap E, not a membership read.
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID);

    expect(decision).toEqual({ proceed: true });
    expect(ensureBootstrapKey).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection from fetchSurvey', async () => {
    h.fetchImpl.current = async () => {
      throw new Error('fetch exploded');
    };
    await expect(
      resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID),
    ).rejects.toThrow('fetch exploded');
  });

  it('propagates a rejection from ensureBootstrapKey', async () => {
    (ensureBootstrapKey as any).mockRejectedValue(new Error('bootstrap exploded'));
    await expect(
      resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID),
    ).rejects.toThrow('bootstrap exploded');
  });
});
