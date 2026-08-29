import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (hoisted with the factory, so the controller's own imports are
// intercepted before resolution). We keep the Node environment and never pull
// jsdom: the small browser surface the controller touches (window/document/
// alert/localStorage) is stubbed below instead.
//
// Task 1 (deferred identity): the controller no longer calls the human-wallet
// authenticate() — entry establishes the random bootstrap leaf E via the mocked
// ensureBootstrapKey, then always registers the (pre-registration) leaf.

const h = vi.hoisted(() => ({
  // Configurable per-test behaviour of the mocked Card.register().
  registerImpl: {
    current: () => Promise.resolve({ receipt: { status: 'success' } }),
  },
  // Every Card instance created by the controller is captured here.
  instances: [] as any[],
}));

vi.mock('@s3ntiment/shared', () => ({
  Card: class {
    public data: any;
    public register = vi.fn((...args: any[]) => h.registerImpl.current(...args));
    constructor(data: any) {
      this.data = data;
      h.instances.push(this);
    }
  },
  parseCardURL: vi.fn(),
  fetchSurvey: vi.fn(),
}));
vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));
vi.mock('../bootstrap.factory.js', () => ({ ensureBootstrapKey: vi.fn() }));
vi.mock('../onpageload.js', () => ({ removeSplash: vi.fn() }));

import { AuthController } from './auth-ctrlr.js';
// These resolve to the mocked factories above.
import { Card, parseCardURL, fetchSurvey } from '@s3ntiment/shared';
import { router } from '../router.js';
import { ensureBootstrapKey } from '../bootstrap.factory.js';
import { store } from '../state/store.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0x00000000000000000000000000000000000000be';
const IPFS_CID = 'QmFakeCid';
const CREATED_AT = '2026-08-28T00:00:00.000Z';
const CARD_URL =
  'http://respondent.local/?n=user-1&b=0x00000000000000000000000000000000000000ff&sig=0x1234&s=' +
  SURVEY_ID;

const CARD_DATA = {
  nullifier: 'user-1',
  batchId: '0x00000000000000000000000000000000000000ff',
  signature: '0x1234',
  surveyOwner: '0x00000000000000000000000000000000000000ee',
  surveyId: SURVEY_ID,
};

function fakeServices(): any {
  return {};
}

function installBrowserGlobals() {
  (globalThis as any).window = { location: { href: CARD_URL } };
  (globalThis as any).document = {
    // '#app' and '#auth-content' both return a plain element node.
    querySelector: () => ({ innerHTML: '', style: {} }),
  };
  (globalThis as any).alert = vi.fn();

  // Minimal in-memory localStorage so importing src/state/store.js (real) works.
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.registerImpl.current = () => Promise.resolve({ receipt: { status: 'success' } });
  h.instances.length = 0;
  installBrowserGlobals();

  (parseCardURL as any).mockResolvedValue(CARD_DATA);
  (fetchSurvey as any).mockResolvedValue([IPFS_CID, POOL_ID, CREATED_AT]);
  (ensureBootstrapKey as any).mockResolvedValue('0x00000000000000000000000000000000000000aa');
});

describe('AuthController (root route "/")', () => {
  it('runs the deferred-identity entry flow: parse -> fetch -> store -> ensure bootstrap E -> register -> navigate', async () => {
    const ctrl = new AuthController(fakeServices());
    await ctrl.render();

    // parseCardURL is fed the live window location
    expect(parseCardURL).toHaveBeenCalledWith(window.location.href);

    // fetchSurvey called with (services, surveyStore, surveyId)
    expect(fetchSurvey).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      SURVEY_ID,
    );

    // survey metadata persisted into the store
    expect(store.getSurveyData(SURVEY_ID)).toMatchObject({
      id: SURVEY_ID,
      pool: POOL_ID,
    });

    // entry establishes the random bootstrap leaf (no human-wallet authenticate)
    expect(ensureBootstrapKey).toHaveBeenCalledWith(expect.anything());

    // leaf E is pre-registration at entry, so card.register (on-chain registerInPool,
    // waits for receipt) runs with (services, surveyStore, poolId)
    const card: any = h.instances[0];
    expect(card).toBeDefined();
    expect(card.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      POOL_ID,
    );

    // success receipt -> navigate straight to the survey
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/surveys/' + SURVEY_ID);
    expect((globalThis as any).alert).not.toHaveBeenCalled();
  });

  it('alerts and does not navigate when the registration receipt is not success', async () => {
    h.registerImpl.current = () =>
      Promise.resolve({ receipt: { status: 'reverted' } });

    const ctrl = new AuthController(fakeServices());
    await ctrl.render();

    expect((globalThis as any).alert).toHaveBeenCalledWith('❌ Card validation failed');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('alerts and does not navigate when card.register rejects', async () => {
    h.registerImpl.current = () => Promise.reject(new Error('register failed'));

    const ctrl = new AuthController(fakeServices());
    await ctrl.render();

    expect((globalThis as any).alert).toHaveBeenCalledWith('❌ Card validation failed');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does nothing when no card is present on the URL', async () => {
    (parseCardURL as any).mockResolvedValue(null);

    const ctrl = new AuthController(fakeServices());
    await ctrl.render();

    expect(fetchSurvey).not.toHaveBeenCalled();
    expect(ensureBootstrapKey).not.toHaveBeenCalled();
    expect(h.instances.length).toBe(0);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
