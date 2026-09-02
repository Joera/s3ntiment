import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). Node environment — no jsdom. The controller's browser-bound
// imports are neutralised: the four custom components extend HTMLElement at
// module load (undefined in node), @s3ntiment/shared/assets + /components and
// the router singleton are faked, and fetchAndDecryptSurveyWithOwner is stubbed
// (only used in process(), which these tests don't call).
//
// The zod seam (@s3ntiment/shared/nillcc) is canonical: the REAL validators are
// kept (shared/dist must be built first) so that if the survey-update output
// validator wrongly ran on a 4xx/5xx body it would throw a real misleading
// 'Survey update output validation failed' zod error — exactly what the
// regression test asserts must NOT happen.
//
// The REAL store is kept and seeded with the existing survey + pool so the
// survey-save handler runs against the actual `store.surveys.find` /
// `this.pool.config` seams.

vi.mock('@s3ntiment/shared', () => ({
  fetchAndDecryptSurveyWithOwner: vi.fn(),
}));
vi.mock('@s3ntiment/shared/nillcc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@s3ntiment/shared/nillcc')>();
  return { ...actual };
});
vi.mock('@s3ntiment/shared/assets', () => ({ renderIcon: vi.fn() }));
vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('../components/survey-detail-responses.js', () => ({}));
vi.mock('../components/pool-detail-access.js', () => ({}));
vi.mock('../components/survey-forms/pool-form-batches.js', () => ({}));
vi.mock('../components/registered-questions-editor.js', () => ({}));
vi.mock('../services/services.js', () => ({}));
vi.mock('../utils/reactive.js', () => ({ reactive: vi.fn() }));
vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }));

import { SurveyController } from './survey.ctrlr.js';
import { store } from '../state/store.js';

const SURVEY_ID = 'survey-abc';
const POOL_ID = '0xpool123';
const SAFE = '0xSafe';

function fakeServices() {
  const safe = {
    connectToExistingSafe: vi.fn(async () => {}),
    connectToFreshSafe: vi.fn(async () => SAFE),
    getSignerAddress: vi.fn(() => '0xOrganiser'),
    signMessage: vi.fn(async (_m: string) => 'sig-1'),
    write: vi.fn(async () => ({ receipt: { status: 'success' } })),
  };
  const ipfs = { isCID: vi.fn(() => true) };
  return { safe, ipfs };
}

// Minimal document shim: querySelector returns null (the controller's
// optional-chained ?.addEventListener calls short-circuit) and
// addEventListener captures the handler keyed by event type so the test can
// invoke the survey-save handler directly.
let capturedListeners: Record<string, Function>;
function installDocumentShim() {
  capturedListeners = {};
  vi.stubGlobal('document', {
    querySelector: () => null,
    addEventListener: vi.fn((type: string, handler: Function) => {
      capturedListeners[type] = handler;
    }),
    removeEventListener: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  store.setPools([]);
  installDocumentShim();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Seed the store with the existing survey + pool that the survey-save handler
// derefs, and build a controller wired to them.
function setupController(services = fakeServices(), fetchImpl?: any) {
  store.addPool({
    id: POOL_ID,
    name: 'coffee pool',
    safeAddress: SAFE,
    batches: [],
    createdAt: 1724800000,
    config: { safe: SAFE, pkpId: '0xpkp123', pkpDid: 'did:pkp:123', groupId: 'group-1' },
  });
  store.addSurvey({
    id: SURVEY_ID,
    title: 'How do you like coffee?',
    pool: POOL_ID,
    introduction: 'Tell us',
    groups: [{ id: 'g1', title: 'Taste', questions: [] }],
    batches: [{ id: 'batch-1', pool: POOL_ID }],
  });

  const ctrl = new SurveyController(services, SURVEY_ID);
  (ctrl as any).pool = { id: POOL_ID, config: { safe: SAFE } };

  if (fetchImpl) {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
  }

  ctrl.setListeners();
  return ctrl;
}

async function fireSurveySave(ctrl: SurveyController, groups: any[]) {
  await (capturedListeners['survey-save'] as any)({
    detail: { surveyId: SURVEY_ID, groups },
  });
}

describe('SurveyController — survey update', () => {
  it('PUT /api/surveys/:id happy path: ok response is output-validated and committed', async () => {
    const services = fakeServices();
    const ctrl = setupController(services, async () => ({
      ok: true,
      text: async () => JSON.stringify({ cid: 'QmFakeCid' }),
    }));

    await fireSurveySave(ctrl, [{ id: 'g1', title: 'Taste', questions: [] }]);

    // Success path: the update tx was written and the new survey config stored.
    expect(services.safe.write).toHaveBeenCalledTimes(1);
    expect(store.surveys.find((s: any) => s.id === SURVEY_ID)?.groups).toHaveLength(1);
  });
});

describe('SurveyController — survey update output validation gated on res.ok (regression)', () => {
  it('PUT /api/surveys/:id non-ok response: surfaces the real backend error + stops, WITHOUT throwing a misleading output-validation error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const services = fakeServices();
    const ctrl = setupController(services, async () => ({
      ok: false,
      text: async () => JSON.stringify({ error: 'update rejected by backend' }),
    }));

    // Must NOT reject: with the bug there was NO res.ok guard — the raw body was
    // JSON.parsed and validateSurveyUpdateOutput ran on the 4xx/5xx body,
    // throwing a misleading 'Survey update output validation failed' zod error.
    await expect(fireSurveySave(ctrl, [{ id: 'g1' }])).resolves.toBeUndefined();

    // The real backend error is surfaced (logged) and the handler stopped.
    expect(errorSpy).toHaveBeenCalledWith(
      'survey update failed (backend):',
      JSON.stringify({ error: 'update rejected by backend' }),
    );
    // No updateSurvey tx, no survey config commit — it returned before both.
    expect(services.safe.write).not.toHaveBeenCalled();
    expect(store.surveys.find((s: any) => s.id === SURVEY_ID)?.groups).toEqual([
      { id: 'g1', title: 'Taste', questions: [] },
    ]);
    errorSpy.mockRestore();
  });
});
