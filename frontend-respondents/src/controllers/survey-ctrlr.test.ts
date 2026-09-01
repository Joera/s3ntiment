import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). We keep the Node environment — no jsdom. The heavy shared barrel
// (Lit / NilDB / IPFS / viem) is stubbed wholesale, the side-effect component
// registrations are neutralised (survey-questions.ts calls customElements.define
// at top level, which would throw in node), and the router singleton is faked.
// The R1 fix (pool config plumbed out of the decrypted EncryptedConfig) is what
// makes the success path reachable — a control-level comment in the subject file
// documents it; here we exercise it.

const h = vi.hoisted(() => ({
  // Configurable impl of the decrypted survey returned by the shared fetch fn.
  decryptImpl: {
    current: undefined as any,
  },
}));

vi.mock('@s3ntiment/shared', () => ({
  fetchAndDecryptSurveyWithRespondent: vi.fn((...args: any[]) =>
    h.decryptImpl.current(...args)
  ),
  isScored: vi.fn((groups: any) => Boolean(groups && groups.length)),
  // imported but unused by the controller (dead import); must still resolve.
  createUserDataObject: vi.fn(),
}));
vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('../components/survey-questions.js', () => ({}));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));

import { SurveyController } from './survey.ctrlr.js';
import { fetchAndDecryptSurveyWithRespondent, isScored } from '@s3ntiment/shared';
import { router } from '../router.js';
import { store } from '../state/store.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0xpool123';
const PKP_ID = '0xpkp123';
const PKP_DID = 'did:pkp:123';
// BACKENDURL is undefined in the node test env (import.meta.env.VITE_* unset);
// it is only forwarded to the mocked shared fn and threaded into the stubbed
// fetch URL, so this is harmless.
const RESPONDENT_ADDR = '0x00000000000000000000000000000000000000aa';

// A decrypted survey shaped like the real EncryptedConfig return: it carries
// the pool config (pkpId/pkpDid/…) on `config`, exactly as the backend reads it
// (nillcc-backend/src/survey.ctrlr.ts: `const { pkpId, pkpDid } = surveyConfig.config`).
const DECRYPTED_SURVEY = {
  id: SURVEY_ID,
  pool: POOL_ID,
  title: 'How do you like coffee?',
  createdAt: 1724800000,
  groups: [
    {
      id: 'g1',
      title: 'Taste',
      questions: [
        {
          id: 'q1',
          question: 'Do you like it?',
          type: 'radio',
          options: ['yes', 'no'],
          required: true,
        },
      ],
    },
  ],
  config: { pkpId: PKP_ID, pkpDid: PKP_DID, chainId: 8453, litNetwork: 'datil-dev' },
};

function fakeServices() {
  const account = {
    createNillDBSeed: vi.fn(async () => 'seed-1'),
    signMessage: vi.fn(async (m: string) => `sig:${m}`),
    getSignerAddress: vi.fn(() => RESPONDENT_ADDR),
  };
  const nillDB = {
    init: vi.fn(async () => {}),
    userDidString: 'did:key:respondent',
    storeOwned: vi.fn(async () => ({ ok: true })),
  };
  return { account, nillDB };
}

// Remembers the 'survey-complete' handler so a test can invoke it manually.
function installBrowserGlobals() {
  const listeners = new Map<string, Function>();
  (globalThis as any).window = { location: { href: '' } };
  // One shared fake element: querySelector('#app') and querySelector('#survey-content')
  // both resolve to it, so innerHTML mutations (renderLoading/renderTemplate and
  // the reactive view) persist and are observable from the test.
  const fakeEl = { innerHTML: '', style: {} };
  (globalThis as any).document = {
    querySelector: () => fakeEl,
    addEventListener: (type: string, cb: Function) => void listeners.set(type, cb),
  };
  (globalThis as any).__surveyGetListener = (type: string) => listeners.get(type);
  (globalThis as any).alert = vi.fn();
  // crypto/fetch are getter-only or read-only globals in modern Node — stub them.
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'doc-123') });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => ({ delegation: 'del-1' }),
  })));
}

function primeStore() {
  store.setSurveyData(SURVEY_ID, { id: SURVEY_ID, pool: POOL_ID });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.decryptImpl.current = async () => DECRYPTED_SURVEY;
  installBrowserGlobals();
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SurveyController.render()', () => {
  it('alerts and does not fetch when the store is not primed (no pool)', async () => {
    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);

    await ctrl.render();

    expect((globalThis as any).alert).toHaveBeenCalledWith(
      'survey and pool not found'
    );
    expect(fetchAndDecryptSurveyWithRespondent).not.toHaveBeenCalled();
    expect((globalThis as any).__surveyGetListener('survey-complete')).toBeUndefined();
  });

  it('loads and renders the survey on the success path (R1 fix makes it reachable)', async () => {
    primeStore();
    // config known before decrypt (e.g. from a prior fetch) is forwarded to the
    // shared decrypt fn; after decrypt the controller re-plumbs it from the
    // decrypted EncryptedConfig's `config` field.
    const knownPoolConfig = { pkpId: '0xpre', pkpDid: 'did:pkp:pre' };

    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);
    (ctrl as any).poolConfig = knownPoolConfig;
    const persistSpy = vi.spyOn(store, 'persistSurveys');

    await ctrl.render();

    // shared decrypt fn called with (services, surveyStore, surveyId, poolConfig, backendUrl)
    expect(fetchAndDecryptSurveyWithRespondent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      SURVEY_ID,
      knownPoolConfig,
      undefined,
    );

    // decrypted content + scoring persisted to the store
    expect(isScored).toHaveBeenCalledWith(DECRYPTED_SURVEY.groups);
    expect(store.getSurveyData(SURVEY_ID)).toMatchObject({
      id: SURVEY_ID,
      pool: POOL_ID,
      title: DECRYPTED_SURVEY.title,
      isScored: true,
    });
    expect(persistSpy).toHaveBeenCalled();

    // R1 fix: pool config plumbed out of the decrypted config
    expect((ctrl as any).poolConfig).toMatchObject({
      pkpId: PKP_ID,
      pkpDid: PKP_DID,
    });

    // renderTemplate() ran: the reactive view bound to store.surveys$ rendered
    // the <survey-questions survey-id=…> component into the shared element.
    const app: any = (globalThis as any).document.querySelector('#app');
    expect(app.innerHTML).toContain('survey-questions');
    expect(app.innerHTML).toContain(`survey-id="${SURVEY_ID}"`);

    // setSurveyListener() registered the 'survey-complete' handler
    expect((globalThis as any).__surveyGetListener('survey-complete')).toBeDefined();
  });

  it('renders the decryption warning and registers no listener when the fetch rejects', async () => {
    primeStore();
    h.decryptImpl.current = async () => {
      throw new Error('decrypt exploded');
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);
    await ctrl.render();

    const app: any = (globalThis as any).document.querySelector('#app');
    expect(app.innerHTML).toContain('Decryption failed');
    expect(app.innerHTML).toContain('decrypt exploded');
    expect(consoleError).toHaveBeenCalled();
    expect((globalThis as any).__surveyGetListener('survey-complete')).toBeUndefined();
    expect(fetchAndDecryptSurveyWithRespondent).toHaveBeenCalled();
  });
});

describe('SurveyController.setSurveyListener() submission', () => {
  function buildController() {
    const services = fakeServices();
    const ctrl = new SurveyController(services, SURVEY_ID);
    (ctrl as any).survey = { id: SURVEY_ID, pool: POOL_ID, title: 'T' };
    (ctrl as any).poolConfig = { safe: '0xSafe', pkpId: PKP_ID, pkpDid: PKP_DID };
    return { services, ctrl };
  }

  it('submits in order: seed -> init -> uuid -> sign -> fetch delegation -> storeOwned -> navigate', async () => {
    const { services, ctrl } = buildController();

    await ctrl.setSurveyListener();
    const cb = (globalThis as any).__surveyGetListener('survey-complete');
    expect(cb).toBeDefined();

    const answers = [{ questionId: 'q1', questionType: 'radio', answer: 'yes' }];
    await cb({ detail: { answers } });

    const aSeed = services.account.createNillDBSeed;
    const aInit = services.nillDB.init;
    const aUUID = (globalThis as any).crypto.randomUUID;
    const aSign = services.account.signMessage;
    const aFetch = (globalThis as any).fetch;
    const aStore = services.nillDB.storeOwned;

    // strict ordering of the async pipeline
    expect(aSeed.mock.invocationCallOrder[0]).toBeLessThan(aInit.mock.invocationCallOrder[0]);
    expect(aInit.mock.invocationCallOrder[0]).toBeLessThan(aUUID.mock.invocationCallOrder[0]);
    expect(aUUID.mock.invocationCallOrder[0]).toBeLessThan(aSign.mock.invocationCallOrder[0]);
    expect(aSign.mock.invocationCallOrder[0]).toBeLessThan(aFetch.mock.invocationCallOrder[0]);
    expect(aFetch.mock.invocationCallOrder[0]).toBeLessThan(aStore.mock.invocationCallOrder[0]);

    expect(aSeed).toHaveBeenCalledWith();
    expect(aInit).toHaveBeenCalledWith('seed-1');
    expect(aSign).toHaveBeenCalledWith('s3ntiment:submit');

    // delegation POST
    expect(aFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = aFetch.mock.calls[0];
    expect(url).toContain(`/api/surveys/${SURVEY_ID}/delegation`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    // GAP-19: the backend delegation route dereferences poolConfig.safe /
    // poolConfig.pkpId / poolConfig.pkpDid. The client must send the full
    // poolConfig object (NOT flat pkpId/pkpDid, which omits `safe` and makes
    // the handler throw). This assertion fails against the pre-fix flat body.
    expect(body).toMatchObject({
      userDid: 'did:key:respondent',
      signature: 'sig:s3ntiment:submit',
      userAddress: RESPONDENT_ADDR,
      poolId: POOL_ID,
      poolConfig: { safe: '0xSafe', pkpId: PKP_ID, pkpDid: PKP_DID },
    });
    // The flat pkpId/pkpDid fields must no longer be sent at the top level.
    expect(body.pkpId).toBeUndefined();
    expect(body.pkpDid).toBeUndefined();

    // storeOwned(docId, survey, poolConfig, answers, surveyId, delegation)
    expect(aStore).toHaveBeenCalledWith(
      'doc-123',
      expect.objectContaining({ id: SURVEY_ID, pool: POOL_ID }),
      { safe: '0xSafe', pkpId: PKP_ID, pkpDid: PKP_DID },
      answers,
      SURVEY_ID,
      'del-1',
    );

    // ok -> navigate to the completion route
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(`complete/${SURVEY_ID}/doc-123`);
  });

  it('does not navigate when storeOwned reports ok:false', async () => {
    const { services, ctrl } = buildController();
    services.nillDB.storeOwned.mockResolvedValue({ ok: false });

    await ctrl.setSurveyListener();
    const cb = (globalThis as any).__surveyGetListener('survey-complete');
    await cb({ detail: { answers: [] } });

    expect(services.nillDB.storeOwned).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('SurveyController.destroy() / process()', () => {
  it('destroy() destroys and clears every reactive view', async () => {
    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);
    const viewA = { destroy: vi.fn() };
    const viewB = { destroy: vi.fn() };
    // push through any to bypass the private member in the test
    (ctrl as any).reactiveViews.push(viewA, viewB);

    ctrl.destroy();

    expect(viewA.destroy).toHaveBeenCalledTimes(1);
    expect(viewB.destroy).toHaveBeenCalledTimes(1);
    expect((ctrl as any).reactiveViews).toEqual([]);
  });

  it('process() is a deliberate no-op', async () => {
    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);
    await expect(ctrl.process()).resolves.toBeUndefined();
  });
});

describe('SurveyController cold-start regression (R1 pool-config gap), pinned', () => {
  // This suite DOCUMENTS the known, intentionally-deferred chicken-and-egg
  // described in SPEC-frontend-respondents.md Gaps: on a FRESH controller's
  // first render() `this.poolConfig` is still undefined when forwarded into
  // fetchAndDecryptSurveyWithRespondent. The real shared fn derefs
  // `poolConfig.pkpId`, so the first render throws and lands in renderWarning.
  // We pin that CURRENT behaviour here so it cannot silently change while the
  // human resolution (source poolConfig before first decrypt) is still pending.
  // We deliberately do NOT pre-seed (ctrl as any).poolConfig and do NOT fix the
  // gap — the shared-fn mock below replicates the real deref-on-undefined so the
  // test exercises the same failure path production would.
  it('fresh controller + un-seeded poolConfig -> renderWarning, no navigate, no renderTemplate', async () => {
    primeStore();
    // Replicate the real shared decrypt fn: it dereferences poolConfig.pkpId,
    // so an undefined poolConfig throws exactly like production on a fresh
    // controller's first render.
    h.decryptImpl.current = (...args: any[]) => {
      const poolConfig = args[3];
      if (!poolConfig) {
        throw new Error("Cannot read properties of undefined (reading 'pkpId')");
      }
      return DECRYPTED_SURVEY;
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctrl = new SurveyController(fakeServices(), SURVEY_ID);
    // NOTE: intentionally no `(ctrl as any).poolConfig = ...` here — that is
    // exactly the deferred R1 gap we are pinning.
    await ctrl.render();

    const app: any = (globalThis as any).document.querySelector('#app');

    // landed in renderWarning, not renderTemplate.
    expect(app.innerHTML).toContain('Decryption failed');
    expect(app.innerHTML).not.toContain('survey-questions');

    // fetch attempted with undefined poolConfig (the gap) then rejected
    expect(fetchAndDecryptSurveyWithRespondent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      SURVEY_ID,
      undefined,
      undefined,
    );

    // no navigation and no submission listener were reached
    expect(router.navigate).not.toHaveBeenCalled();
    expect((globalThis as any).__surveyGetListener('survey-complete')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
