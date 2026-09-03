import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks (hoisted). The shared components barrel and the router singleton are
// neutralised; `store` and the REAL storage helpers stay live so the CTA gating on
// `anchor_address === undefined` is exercised against the actual localStorage mock.

vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('@s3ntiment/shared', () => ({
  // CompletedController now consumes the shared zod nillcc request-validator
  // (validateScoreInput) on the scored-survey render path.
  validateScoreInput: vi.fn((input: any) => input),
  // …and the shared zod nillcc RESPONSE-validator (validateScoreOutput) on the
  // scored path; stubbed with real teeth (throws on a body missing `score`) so
  // a wrong response shape fails the regression test.
  validateScoreOutput: vi.fn((body: any) => {
    if (!body || typeof body.score === 'undefined') {
      throw new Error('Score output validation failed: score: score is required');
    }
    return body;
  }),
}));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));

import { CompletedController } from './completed-ctrlr.js';
import { router } from '../router.js';
import { store } from '../state/store.js';
import {
  saveAnchorAddressFromStorage,
} from '../state/storage.js';

function installBrowserGlobals() {
  const handlers = new Map<string, Map<string, Function>>();
  // '#app' and the reactive selector '#completed-content' both resolve to this
  // element so renderTemplate() builds + binds its view.
  const appEl: any = { innerHTML: '', style: {} };
  (globalThis as any).document = {
    querySelector: () => appEl,
    getElementById: (id: string) => {
      const elHandlers = new Map<string, Function>();
      handlers.set(id, elHandlers);
      return {
        addEventListener: (type: string, cb: Function) => void elHandlers.set(type, cb),
      };
    },
  };
  (globalThis as any).window = { location: { href: '' } };
  (globalThis as any).__completedGetHandler = (id: string, type: string) =>
    handlers.get(id)?.get(type);
}

beforeEach(() => {
  vi.clearAllMocks();
  installBrowserGlobals();
  (globalThis as any).localStorage.clear();
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CompletedController — "secure your stealth account" CTA', () => {
  it('renders the CTA when anchor_address is undefined (not yet secured)', async () => {
    const ctrl = new CompletedController({} as any, 'survey-abc', 'doc-1');

    await ctrl.render();

    const html = (globalThis as any).document.querySelector()!.innerHTML as string;
    expect(html).toContain('secure-account-btn');
    expect(html).toContain('Secure your stealth account');
  });

  it('does NOT render the CTA once anchor_address is set (already secured)', async () => {
    saveAnchorAddressFromStorage('you@example.com');

    const ctrl = new CompletedController({} as any, 'survey-abc', 'doc-1');
    await ctrl.render();

    const html = (globalThis as any).document.querySelector()!.innerHTML as string;
    expect(html).not.toContain('secure-account-btn');
    expect(html).not.toContain('Secure your stealth account');
  });

  it('clicking the CTA navigates to /account', async () => {
    const ctrl = new CompletedController({} as any, 'survey-abc', 'doc-1');
    await ctrl.render();

    const click = (globalThis as any).__completedGetHandler('secure-account-btn', 'click');
    expect(click).toBeDefined();

    await click();

    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/account');
  });

  it('destroy() clears every bound reactive view', async () => {
    const ctrl = new CompletedController({} as any, 'survey-abc', 'doc-1');
    const viewA = { destroy: vi.fn() };
    const viewB = { destroy: vi.fn() };
    (ctrl as any).reactiveViews.push(viewA, viewB);

    ctrl.destroy();

    expect(viewA.destroy).toHaveBeenCalledTimes(1);
    expect(viewB.destroy).toHaveBeenCalledTimes(1);
    expect((ctrl as any).reactiveViews).toEqual([]);
  });
});

describe('CompletedController — score output validation gated on res.ok (regression)', () => {
  function primeScoredSurvey() {
    store.setSurveyData('survey-abc', { id: 'survey-abc', pool: '0xpool', isScored: true } as any);
    store.setActiveSurvey('survey-abc');
  }

  function scoredServices() {
    return {
      account: {
        getSignerAddress: vi.fn(() => '0xResp'),
        signMessage: vi.fn(async () => 'sig'),
      },
    };
  }

  it('ok response with a valid { score } body: score is set', async () => {
    primeScoredSurvey();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ score: 7 }) })));

    const ctrl = new CompletedController(scoredServices() as any, 'survey-abc', 'doc-1');
    await ctrl.render();

    // The real { score } response shape passes validation and is assigned.
    expect((ctrl as any).score).toBe(7);
  });

  it('ok response with a WRONG shape (missing score): fails loudly', async () => {
    primeScoredSurvey();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ foo: 'bar' }) })));

    const ctrl = new CompletedController(scoredServices() as any, 'survey-abc', 'doc-1');

    // The output validator throws on the malformed body.
    await expect(ctrl.render()).rejects.toThrow(/Score output validation failed/);
  });

  it('non-ok response: surfaces the real backend error (no misleading output-validation error), score not set', async () => {
    primeScoredSurvey();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));

    const ctrl = new CompletedController(scoredServices() as any, 'survey-abc', 'doc-1');

    // Must NOT reject — the non-ok branch logs + stops before the validator.
    await expect(ctrl.render()).resolves.toBeUndefined();
    expect((ctrl as any).score).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith('ERROR', expect.anything());
    logSpy.mockRestore();
  });
});
