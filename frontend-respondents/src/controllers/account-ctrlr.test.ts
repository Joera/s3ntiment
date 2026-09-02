import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- AccountController secure/recover tests (Task 2 + PR #26 safety fixes).
// Services are mocked; the humanWallet `authenticate` is stubbed to control the
// derived S key/address; the real signRotateMessage digest + sign path runs
// against a faked `signer.sign`; storage helpers are REAL (drives localStorage
// assertions).
//
// CANONICAL ORDER under test:
//   derive S -> (E still the member/signer) nilDB migrate E->S (recreate-then-
//   delete) -> rotateMember(poolId, S, sigByE) -> only on FULL success wipe E +
//   persist S + set anchor_address. On ANY failure: keep E, no wipe, no anchor.

vi.mock('@s3ntiment/shared/components', () => ({}));
vi.mock('@s3ntiment/shared', () => ({
  // AccountController now consumes the shared zod nillcc request-validator
  // (validateDelegationInput) at runtime. The migrate payload built in these
  // tests is valid, so it is stubbed to pass (return the input); the validator
  // logic itself is unit-tested in @s3ntiment/shared.
  validateDelegationInput: vi.fn((input: any) => input),
}));
vi.mock('../humanWallet.factory.js', () => ({ authenticate: vi.fn() }));

import { AccountController } from './account-ctrlr.js';
import { authenticate } from '../humanWallet.factory.js';
import { store } from '../state/store.js';
import {
  saveBootstrapKeyToStorage,
  loadDerivedSKeyFromStorage,
  loadAnchorAddressFromStorage,
} from '../state/storage.js';

const OLD_LEAF = '0x00000000000000000000000000000000000000e1';
const BOOTSTRAP_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
const S_KEY = '0x2222222222222222222222222222222222222222222222222222222222222222';
const S_ADDR = '0x00000000000000000000000000000000000000ab';
const POOL_ID = '0x0000000000000000000000000000000000000001';
const SURVEY_ID = 'survey-abc';
const EMAIL = 'you@example.com';

const POOL_CONFIG = { safe: '0xSafe', pkpId: '0xpkp', pkpDid: 'did:pkp:1' };

// A fake signing account with a controllable `.sign({ hash })` — signRotateMessage
// runs its real viem digest machinery over this mock.
function signerThatSigns(sig: string = '0xsig') {
  return { sign: vi.fn().mockResolvedValue(sig) };
}

// A services object modelling the smart-account + nilDB + backend delegation path.
function fakeServices(overrides: any = {}) {
  const account: any = {
    getSignerAddress: vi.fn(() => OLD_LEAF),
    getSigner: vi.fn(() => signerThatSigns()),
    updateSignerWithKey: vi.fn(async () => {}),
    createNillDBSeed: vi.fn(async () => 'seed-e'),
    signMessage: vi.fn(async (m: string) => `sig:${m}`),
    write: vi.fn(async () => ({ receipt: { status: 'success' } })),
  };
  const nillDB: any = {
    init: vi.fn(async () => {}),
    listOwnedBySurvey: vi.fn(async () => []),
    deleteOwnedData: vi.fn(async () => ({ ok: true })),
    createData: vi.fn(async () => ({ ok: true, response: {} })),
  };
  const services: any = { account, nillDB, ...overrides };
  return services;
}

function primeStore() {
  store.setSurveyData(SURVEY_ID, {
    id: SURVEY_ID,
    pool: POOL_ID,
    config: POOL_CONFIG,
  } as any);
  store.setActiveSurvey(SURVEY_ID);
}

function bootstrapKept() {
  return (globalThis as any).localStorage.getItem('bootstrapE') === BOOTSTRAP_KEY;
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).localStorage.clear();
  saveBootstrapKeyToStorage(BOOTSTRAP_KEY);
  primeStore();
  (authenticate as any).mockResolvedValue({
    key: S_KEY,
    address: S_ADDR,
    participating: false,
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => ({ delegation: 'del-for-s' }),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountController.secureWithEmailWallet — first-time secure (canonical order)', () => {
  it('migrates E->S, then rotates, then wipes E and persists S + anchor on full success', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1', surveyId: SURVEY_ID } },
    ]);

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    // success + anchor persisted + S persisted + E wiped
    expect(result.ok).toBe(true);
    expect(result.anchor).toBe(EMAIL);
    expect(loadAnchorAddressFromStorage()).toBe(EMAIL);
    expect(loadDerivedSKeyFromStorage()).toBe(S_KEY);
    expect(bootstrapKept()).toBe(false);

    // rotateMember called with the derived S address + signature (sig by old leaf)
    expect(services.account.write).toHaveBeenCalledTimes(1);
    const [writeAddr, , method, args] = services.account.write.mock.calls[0];
    expect(method).toBe('rotateMember');
    expect(args[0]).toBe(POOL_ID);
    expect(args[1]).toBe(S_ADDR);
    expect(args[2]).toBe('0xsig');
    expect(writeAddr).toBeDefined();

    // CANONICAL ORDER: nilDB migration runs BEFORE the on-chain rotate (so E is
    // still the member during the record move), and delete runs AFTER create.
    const createOrder = services.nillDB.createData.mock.invocationCallOrder[0];
    const deleteOrder = services.nillDB.deleteOwnedData.mock.invocationCallOrder[0];
    const writeOrder = services.account.write.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(writeOrder);
    expect(deleteOrder).toBeLessThan(writeOrder);
    expect(deleteOrder).toBeGreaterThan(createOrder);

    expect(services.nillDB.listOwnedBySurvey).toHaveBeenCalledWith(SURVEY_ID);
    expect(services.nillDB.deleteOwnedData).toHaveBeenCalledWith(
      SURVEY_ID,
      'doc-e1',
      [{ _id: 'u1', surveyId: SURVEY_ID }],
    );
    expect(services.nillDB.createData).toHaveBeenCalledTimes(1);

    // GAP-19 (2nd caller): the delegation fetch for S must send the full
    // `poolConfig` object ({safe,pkpId,pkpDid}) the backend route consumes —
    // NOT flat pkpId/pkpDid (which omitted `safe` and made the handler throw).
    const fetchMock: any = (globalThis as any).fetch;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`/api/surveys/${SURVEY_ID}/delegation`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      userDid: `did:key:${'seed-e'}`,
      signature: 'sig:s3ntiment:migrate',
      userAddress: OLD_LEAF,
      poolId: POOL_ID,
      poolConfig: { safe: '0xSafe', pkpId: '0xpkp', pkpDid: 'did:pkp:1' },
    });
    // flat fields must no longer be sent at the top level.
    expect(body.pkpId).toBeUndefined();
    expect(body.pkpDid).toBeUndefined();
  });
});

describe('AccountController.secureWithEmailWallet — BLOCKING-1: recreate-then-delete', () => {
  it('keeps E IN FULL (delete never runs) when recreating records under S throws', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1' } },
    ]);
    // recreate fails BEFORE any E copy is deleted
    services.nillDB.createData.mockRejectedValue(new Error('nil write failed'));

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    // BLOCKING-1 fix: because recreate-then-delete, a recreate failure means the
    // E records were NEVER deleted -> no orphan, E's records survive.
    expect(services.nillDB.deleteOwnedData).not.toHaveBeenCalled();
    expect(services.nillDB.createData).toHaveBeenCalledTimes(1);
    // fail-safe storage: E retained, no wipe, no anchor
    expect(bootstrapKept()).toBe(true);
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
    expect(loadDerivedSKeyFromStorage()).toBeNull();
    // on-chain rotate never attempted
    expect(services.account.write).not.toHaveBeenCalled();
  });

  it('treats a failed delete AFTER a successful recreate as a harmless duplicate and completes', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1' } },
    ]);
    // create succeeds (S owns a copy), then delete fails -> duplicate left in E
    services.nillDB.deleteOwnedData.mockResolvedValue({ ok: false });

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    // not an orphan: S owns the copy; the secure flow still completes
    expect(result.ok).toBe(true);
    expect(loadAnchorAddressFromStorage()).toBe(EMAIL);
    expect(loadDerivedSKeyFromStorage()).toBe(S_KEY);
    expect(services.nillDB.createData).toHaveBeenCalledTimes(1);
    expect(services.account.write).toHaveBeenCalledTimes(1);
  });
});

describe('AccountController.secureWithEmailWallet — BLOCKING-2: list failures are surfaced', () => {
  it('aborts migration (keeps E, no anchor, no rotate) when listing records fails', async () => {
    const services = fakeServices();
    // nilDB list throws (transient error / network) -> must NOT be treated as []
    services.nillDB.listOwnedBySurvey.mockRejectedValue(new Error('nilDB down'));

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('migration_list_failed');
    // no migration steps ran past the list, no on-chain change
    expect(services.nillDB.createData).not.toHaveBeenCalled();
    expect(services.nillDB.deleteOwnedData).not.toHaveBeenCalled();
    expect(services.account.write).not.toHaveBeenCalled();
    // FAIL-SAFE: E retained, no wipe, no anchor — real answers stay under E
    expect(bootstrapKept()).toBe(true);
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
    expect(loadDerivedSKeyFromStorage()).toBeNull();
  });
});

describe('AccountController.secureWithEmailWallet — on-chain rotate failure', () => {
  it('keeps E and sets no anchor when rotateMember reverts after a successful migration', async () => {
    const services = fakeServices();
    // no E records to migrate (genuine empty) -> migration ok; rotate then fails
    services.nillDB.listOwnedBySurvey.mockResolvedValue([]);
    services.account.write.mockResolvedValue({ receipt: { status: 'reverted' } });

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rotate_reverted');
    // E retained, no wipe, no anchor (S is not yet a member on-chain)
    expect(bootstrapKept()).toBe(true);
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
    expect(loadDerivedSKeyFromStorage()).toBeNull();
    expect(services.account.write).toHaveBeenCalledTimes(1);
    expect(services.nillDB.createData).not.toHaveBeenCalled();
  });
});

describe('AccountController.secureWithEmailWallet — Case-2 recover (S already a member)', () => {
  it('recovers an already-member S without re-registering it, migrating E2 docs to S', async () => {
    const services = fakeServices();
    // S is ALREADY a member on this pool (returning user).
    (authenticate as any).mockResolvedValue({
      key: S_KEY,
      address: S_ADDR,
      participating: true,
    });
    // E2 created one new record in this session that must move onto S.
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e2-1', data: { _id: 'u2', surveyId: SURVEY_ID } },
    ]);

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(true);
    expect(loadAnchorAddressFromStorage()).toBe(EMAIL);
    expect(loadDerivedSKeyFromStorage()).toBe(S_KEY);
    expect(bootstrapKept()).toBe(false);

    // rotateMember drops the orphan E2 (S already member -> net -1); no registerInPool
    const method = services.account.write.mock.calls[0][2];
    expect(method).toBe('rotateMember');
    // recreate-then-delete applied to E2's docs
    expect(services.nillDB.deleteOwnedData).toHaveBeenCalledWith(
      SURVEY_ID,
      'doc-e2-1',
      [{ _id: 'u2', surveyId: SURVEY_ID }],
    );
    expect(services.nillDB.createData).toHaveBeenCalledTimes(1);
    expect(services.account.write).toHaveBeenCalledTimes(1);
  });
});
