import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- The gate helpers are imported AFTER these mocks are hoisted, so the
// helper module resolves against the mocked Card / fetchSurvey / auth fns.
// `Card` is mocked so we control `isUsed` per test (mirrors auth-ctrlr.test's
// instance-capturing mock); `store` is the REAL store (like survey-ctrlr.test
// uses) so we can assert the gate populates survey data.

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

vi.mock('./auth.factory.js', () => ({
  hasParticipatingAccount: vi.fn(),
  authenticate: vi.fn(),
}));

import {
  resolveRootGate,
  resolveSurveyGate,
} from './router.gates.js';
import { Card } from '../../shared/src/shared/invites/card.factory.js';
import { hasParticipatingAccount, authenticate } from './auth.factory.js';
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
    // Card built from cardData; isUsed consulted with (services, surveyStore)
    const card: any = h.instances[0];
    expect(card).toBeDefined();
    expect(card.data).toBe(CARD_DATA);
    expect(card.isUsed).toHaveBeenCalledWith(expect.anything(), SURVEY_STORE);
  });

  it('fresh card -> proceed', async () => {
    const decision = await resolveRootGate(fakeServices(), CARD_DATA, SURVEY_STORE);
    expect(decision).toEqual({ proceed: true });
    expect(h.instances[0].isUsed).toHaveBeenCalledWith(expect.anything(), SURVEY_STORE);
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

describe('resolveSurveyGate (/surveys/:surveyId entry gate)', () => {
  function mockParticipation(participant: boolean, authResult: boolean) {
    (hasParticipatingAccount as any).mockResolvedValue(participant);
    (authenticate as any).mockResolvedValue(authResult);
  }

  it('missing surveyId -> navigate /surveys (no fetch, no participation checks)', async () => {
    mockParticipation(true, true);
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, '');

    expect(decision).toEqual({ navigate: '/surveys' });
    expect(hasParticipatingAccount).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('pool member -> proceed, and fetchSurvey populates the store', async () => {
    mockParticipation(true, true);
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID);

    expect(decision).toEqual({ proceed: true });
    expect(authenticate).not.toHaveBeenCalled();

    // fetchSurvey populates the store via setSurveyData + setActiveSurvey
    expect(store.getSurveyData(SURVEY_ID)).toMatchObject({
      id: SURVEY_ID,
      pool: POOL_ID,
    });
    expect(store.activeSurveyId).toBe(SURVEY_ID);
    expect(store.activeSurvey).toMatchObject({ id: SURVEY_ID });
  });

  it('non-member who authenticates successfully -> proceed', async () => {
    mockParticipation(false, true);
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID);

    expect(decision).toEqual({ proceed: true });
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), POOL_ID);
  });

  it('non-member whose authentication fails -> navigate /invalid-card', async () => {
    mockParticipation(false, false);
    const decision = await resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID);

    expect(decision).toEqual({ navigate: '/invalid-card' });
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), POOL_ID);
  });

  it('propagates a rejection from fetchSurvey', async () => {
    mockParticipation(true, true);
    h.fetchImpl.current = async () => {
      throw new Error('fetch exploded');
    };
    await expect(
      resolveSurveyGate(fakeServices(), SURVEY_STORE, SURVEY_ID),
    ).rejects.toThrow('fetch exploded');
  });
});
