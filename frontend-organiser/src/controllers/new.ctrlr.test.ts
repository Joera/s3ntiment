import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). Node environment — no jsdom, no browser DOM. The controller's
// browser-bound / heavy imports are neutralised: draft-survey-editor.ts extends
// HTMLElement at module load (undefined in node), survey.factory.ts pulls in
// viem/permissionless/invitation.factory, @s3ntiment/shared is only used for
// types (Batch/Survey), and the router singleton is faked.
//
// The REAL store is kept (seeded per-test) so the test exercises the actual
// `store.getPool(poolId).config` seam that the create-survey payload depends on
// — the same seam that was dropped when the pool identity was only ever stored
// on the Pool (GAP-3). fetch is stubbed per-URL so the full create-pool +
// create-survey sequence runs against deterministic responses.

vi.mock('@s3ntiment/shared', () => ({
  // The controller consumes nillcc request-validators from the canonical zod
  // subpath (@s3ntiment/shared/nillcc), not the barrel — Batch/Survey are
  // type-only imports here.
}));
// The zod seam (@s3ntiment/shared/nillcc) is canonical. Keep the REAL
// validators (shared/dist must be built first — see nillcc-payloads.test.ts)
// so the round-trip runs against real zod; only validatePoolCreateInput is
// overridable so the fail-fast-before-fetch path can be forced below.
vi.mock('@s3ntiment/shared/nillcc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@s3ntiment/shared/nillcc')>();
  return { ...actual, validatePoolCreateInput: vi.fn() };
});
vi.mock('../components/draft-survey-editor.js', () => ({}));
vi.mock('../factories/survey.factory.js', () => ({ createBatch: vi.fn() }));
vi.mock('../services/services.js', () => ({}));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));

import { NewSurveyController } from './new.ctrlr.ts.ts';
import { validatePoolCreateInput } from '@s3ntiment/shared/nillcc';
import { createBatch } from '../factories/survey.factory.js';
import { router } from '../router.js';
import { store } from '../state/store.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0xpool123';
const PKP_ID = '0xpkp123';
const PKP_DID = 'did:pkp:123';
const SAFE = '0xSafe';
const CID = 'QmFakeCid';

const mockCreateBatch = vi.mocked(createBatch);

// The pool identity block the backend create() derefs (pkpId/pkpDid/safe).
function poolIdentity() {
  return { safe: SAFE, pkpId: PKP_ID, pkpDid: PKP_DID, groupId: 'group-1' };
}

function fakeServices() {
  const safe = {
    connectToFreshSafe: vi.fn(async () => SAFE),
    connectToExistingSafe: vi.fn(async () => {}),
    getSignerAddress: vi.fn(() => '0xOrganiser'),
    signMessage: vi.fn(async (_m: string) => 'sig-1'),
    write: vi.fn(async () => ({ receipt: { status: 'success' } })),
  };
  const ipfs = { isCID: vi.fn(() => true) };
  return { safe, ipfs };
}

// Per-URL fetch: the new-pool path POSTs /api/pools, /api/builder/register and
// /api/surveys in sequence. Returns the pool identity from /api/pools, exactly
// as the live backend does. Pass `failing` (array of URL substrings) to make a
// given endpoint return a non-ok response with an error body — used to prove
// the output validators are gated on res.ok and don't throw over a 4xx/5xx.
function installBrowserGlobals(failing: string[] = []) {
  vi.stubGlobal('crypto', {
    randomUUID: vi
      .fn()
      .mockReturnValueOnce(SURVEY_ID)
      .mockReturnValue(POOL_ID),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any) => {
      const u = String(url);
      if (failing.some((f) => u.includes(f))) {
        // Real backend error body — deliberately NOT shaped like the success
        // output, so if an output validator wrongly ran on it it would throw a
        // misleading 'X output validation failed' zod error.
        return { ok: false, json: async () => ({ error: 'backend rejected the request' }), text: async () => 'backend rejected the request' };
      }
      if (u.includes('/api/pools')) {
        return {
          ok: true,
          json: async () => ({ ...poolIdentity(), delegation: 'del-1' }),
        };
      }
      if (u.includes('/api/builder/register')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (u.includes('/api/surveys')) {
        return { ok: true, json: async () => ({ cid: CID }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store.setPools([]);
  store.clear();
  installBrowserGlobals();
  mockCreateBatch.mockImplementation(async (_svc: any, batch: any, poolId: string, surveyId: string) => ({
    ...batch,
    id: '0x' + 'ba'.repeat(20),
    pool: poolId,
    survey: surveyId,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewSurveyController — create-survey payload contract', () => {
  it('attaches the freshly created pool config to POST /api/surveys (new-pool path)', async () => {
    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    // A brand-new pool: survey.pool is absent, so the handler runs the full
    // create-pool -> register-builder -> addPool -> create-survey sequence.
    const draftBatch = {
      id: '',
      name: 'batch-1',
      pool: '',
      survey: '',
      amount: 3,
      medium: 'zip-file',
      createdAt: 1724800000,
    };
    await (ctrl as any).handleSurveySubmit({
      detail: {
        survey: {
          title: 'How do you like coffee?',
          introduction: 'Tell us',
          groups: [{ id: 'g1', title: 'Taste', questions: [] }],
          batches: [draftBatch],
        },
      },
    });

    // The pool identity returned by /api/pools was stored on the Pool via
    // addPool and must be plumbed onto the survey POST as `poolConfig`.
    const fetchMock = (globalThis as any).fetch;
    const surveyCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('/api/surveys'));
    expect(surveyCall).toBeDefined();

    const [, opts] = surveyCall;
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);

    expect(body.signature).toBe('sig-1');
    expect(body.userAddress).toBe('0xOrganiser');
    expect(body.surveyConfig).toMatchObject({
      id: SURVEY_ID,
      pool: POOL_ID,
      title: 'How do you like coffee?',
    });

    // Regression guard: the create POST must carry the pool identity the backend
    // create() derefs (pkpId/pkpDid/safe) as a separate poolConfig. This is the
    // field whose omission caused the destructure-of-undefined crash.
    expect(body.poolConfig).toMatchObject(poolIdentity());
    expect(body.poolConfig.pkpId).toBe(PKP_ID);
    expect(body.poolConfig.pkpDid).toBe(PKP_DID);
    expect(body.poolConfig.safe).toBe(SAFE);

    // Pool identity must not be re-embedded on the survey config itself.
    expect(body.surveyConfig.config).toBeUndefined();

    // happy path completes: survey tx written and the batch route reached
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(`/batch/${POOL_ID}/${'0x' + 'ba'.repeat(20)}`);
  });

  it('attaches the stored pool config to POST /api/surveys (existing-pool path)', async () => {
    // Prime the store with an existing pool carrying the pool identity.
    store.addPool({
      id: POOL_ID,
      name: 'coffee pool',
      safeAddress: SAFE,
      batches: [],
      createdAt: 1724800000,
      config: { ...poolIdentity(), chainId: 8453, litNetwork: 'datil-dev' },
    });

    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    await (ctrl as any).handleSurveySubmit({
      detail: {
        survey: {
          title: 'How do you like coffee?',
          introduction: 'Tell us',
          groups: [{ id: 'g1', title: 'Taste', questions: [] }],
          batches: [{ id: 'batch-1', pool: POOL_ID }],
          pool: POOL_ID,
        },
      },
    });

    const fetchMock = (globalThis as any).fetch;
    const surveyCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('/api/surveys'));
    expect(surveyCall).toBeDefined();

    const [, opts] = surveyCall;
    const body = JSON.parse(opts.body);

    // The pool config comes straight off the stored Pool (store.getPool(poolId).config).
    expect(body.poolConfig).toEqual({
      safe: SAFE,
      pkpId: PKP_ID,
      pkpDid: PKP_DID,
      groupId: 'group-1',
      chainId: 8453,
      litNetwork: 'datil-dev',
    });
    expect(body.surveyConfig.config).toBeUndefined();
  });
});

describe('NewSurveyController — producer-side boundary validation (fail-fast)', () => {
  it('aborts the pool create without sending when the zod input validator throws', async () => {
    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    // Simulate a malformed pool payload (e.g. missing safeAddress): the zod
    // validator (validatePoolCreateInput) throws and the fetch must never fire.
    vi.mocked(validatePoolCreateInput).mockImplementationOnce(() => {
      throw new Error(
        'Pool create input validation failed:\nsafeAddress: safeAddress is required',
      );
    });

    await expect(
      (ctrl as any).handleSurveySubmit({
        detail: {
          survey: {
            title: 'x',
            introduction: 'y',
            groups: [],
            batches: [{ id: '', pool: '' }],
          },
        },
      }),
    ).rejects.toThrow('Pool create input validation failed');

    const fetchMock = (globalThis as any).fetch;
    const poolCall = fetchMock.mock.calls.find((c: any[]) =>
      String(c[0]).includes('/api/pools'),
    );
    expect(poolCall).toBeUndefined();
  });
});

describe('NewSurveyController — output validation gated on res.ok (regression)', () => {
  // Regression for the audit finding: the output validators used to run
  // UNCONDITIONALLY, so a real backend 4xx/5xx threw a misleading zod
  // 'X output validation failed' error over the error body instead of
  // surfacing the real backend error and stopping. Each site must now only run
  // its output validator when res.ok === true, and follow its existing error
  // path (set error UI / log) + return on a non-ok response.

  // A brand-new-pool survey event: runs the full create-pool ->
  // register-builder -> create-survey sequence, whichever endpoint fails.
  function newPoolEvent() {
    return {
      detail: {
        survey: {
          title: 'How do you like coffee?',
          introduction: 'Tell us',
          groups: [{ id: 'g1', title: 'Taste', questions: [] }],
          batches: [
            {
              id: '',
              name: 'batch-1',
              pool: '',
              survey: '',
              amount: 3,
              medium: 'zip-file',
              createdAt: 1724800000,
            },
          ],
        },
      },
    };
  }

  it('pool create: a non-ok /api/pools response sets error UI + returns without throwing a misleading output-validation error', async () => {
    installBrowserGlobals(['/api/pools']);
    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    // Must NOT reject: with the bug, validatePoolCreateOutput would throw a
    // misleading zod error over the 4xx error body. It must instead follow the
    // intended error path (setUI error) and stop.
    await expect((ctrl as any).handleSurveySubmit(newPoolEvent())).resolves.toBeUndefined();

    expect(store.ui.newStep).toBe('error');
    const fetchMock = (globalThis as any).fetch;
    // Nothing after the pool create may run: no builder register, no survey
    // create, no navigation.
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/builder/register')).length).toBe(0);
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/surveys')).length).toBe(0);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('builder register: a non-ok /api/builder/register response logs + returns without throwing a misleading output-validation error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    installBrowserGlobals(['/api/builder/register']);
    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    // Must NOT reject: with the bug, validateRegisterBuilderOutput would throw
    // a misleading zod error over the 4xx error body. It must instead log and stop.
    await expect((ctrl as any).handleSurveySubmit(newPoolEvent())).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith('builder registration failed');
    const fetchMock = (globalThis as any).fetch;
    // Survey create must never run after a failed builder register.
    expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/surveys')).length).toBe(0);
    expect(router.navigate).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('survey create: a non-ok /api/surveys response sets error UI + returns without throwing a misleading output-validation error', async () => {
    installBrowserGlobals(['/api/surveys']);
    const services = fakeServices();
    const ctrl = new NewSurveyController(services);

    // Must NOT reject: with the bug, validateSurveyCreateOutput would throw a
    // misleading zod error over the 4xx error body. It must instead set error UI and stop.
    await expect((ctrl as any).handleSurveySubmit(newPoolEvent())).resolves.toBeUndefined();

    expect(store.ui.newStep).toBe('error');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
