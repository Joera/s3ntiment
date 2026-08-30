import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- AccountController secure/recover tests (Task 2). Services are mocked; the
// humanWallet `authenticate` is stubbed to control the derived S key/address; the
// real signRotateMessage digest + sign path runs against a faked `signer.sign`;
// storage helpers are REAL (drives the localStorage assertions).

vi.mock('@s3ntiment/shared/components', () => ({}));
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

const POOL_CONFIG = { pkpId: '0xpkp', pkpDid: 'did:pkp:1' };

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

describe('AccountController.secureWithEmailWallet — first-time secure (E -> S)', () => {
  it('rotates membership, migrates records, wipes E, and persists S + anchor on full success', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1', surveyId: SURVEY_ID } },
    ]);

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    // success + anchor persisted
    expect(result.ok).toBe(true);
    expect(result.anchor).toBe(EMAIL);
    expect(loadAnchorAddressFromStorage()).toBe(EMAIL);
    expect(loadDerivedSKeyFromStorage()).toBe(S_KEY);

    // E wiped (N1), S persisted
    expect((globalThis as any).localStorage.getItem('bootstrapE')).toBeNull();

    // rotateMember called with the derived S address + signature (sig by old leaf)
    expect(services.account.updateSignerWithKey).toHaveBeenCalledWith(BOOTSTRAP_KEY);
    expect(services.account.updateSignerWithKey).toHaveBeenCalledWith(S_KEY);
    expect(services.account.write).toHaveBeenCalledTimes(1);
    const [writeAddr, , method, args] = services.account.write.mock.calls[0];
    expect(method).toBe('rotateMember');
    expect(args[0]).toBe(POOL_ID);
    expect(args[1]).toBe(S_ADDR);
    expect(args[2]).toBe('0xsig');
    expect(writeAddr).toBeDefined();

    // nilDB two-client migration ran: read/delete under E (init seed-e), recreate under S
    expect(services.nillDB.listOwnedBySurvey).toHaveBeenCalledWith(SURVEY_ID);
    expect(services.nillDB.deleteOwnedData).toHaveBeenCalledWith(
      SURVEY_ID,
      'doc-e1',
      [{ _id: 'u1', surveyId: SURVEY_ID }],
    );
    expect(services.nillDB.createData).toHaveBeenCalledTimes(1);
  });

  it('does not persist S or anchor when the on-chain rotate reverts', async () => {
    const services = fakeServices();
    services.account.write.mockResolvedValue({ receipt: { status: 'reverted' } });

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rotate_reverted');
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
    expect(loadDerivedSKeyFromStorage()).toBeNull();
    expect((globalThis as any).localStorage.getItem('bootstrapE')).toBe(BOOTSTRAP_KEY);
  });
});

describe('AccountController.secureWithEmailWallet — migration fail-safe', () => {
  it('keeps E and does NOT set anchor when the E->S record migration fails', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1' } },
    ]);
    // delete under E fails -> migration aborts
    services.nillDB.deleteOwnedData.mockResolvedValue({ ok: false });

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('migration_delete_failed');
    // FAIL-SAFE: E kept, no anchor, no S persisted
    expect((globalThis as any).localStorage.getItem('bootstrapE')).toBe(BOOTSTRAP_KEY);
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
    expect(loadDerivedSKeyFromStorage()).toBeNull();
    // on-chain rotate happened but nothing persisted
    expect(services.account.write).toHaveBeenCalledTimes(1);
  });

  it('keeps E when recreating records under S throws', async () => {
    const services = fakeServices();
    services.nillDB.listOwnedBySurvey.mockResolvedValue([
      { documentId: 'doc-e1', data: { _id: 'u1' } },
    ]);
    services.nillDB.createData.mockRejectedValue(new Error('nil write failed'));

    const ctrl = new AccountController(services as any);
    const result = await ctrl.secureWithEmailWallet(EMAIL, POOL_ID);

    expect(result.ok).toBe(false);
    expect((globalThis as any).localStorage.getItem('bootstrapE')).toBe(BOOTSTRAP_KEY);
    expect(loadAnchorAddressFromStorage()).toBeUndefined();
  });
});

describe('AccountController.secureWithEmailWallet — Case-2 recover / re-assign', () => {
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
    expect((globalThis as any).localStorage.getItem('bootstrapE')).toBeNull();

    // rotateMember drops the orphan E2 (S already member -> net -1); no registerInPool
    const method = services.account.write.mock.calls[0][2];
    expect(method).toBe('rotateMember');
    expect(services.nillDB.deleteOwnedData).toHaveBeenCalledWith(
      SURVEY_ID,
      'doc-e2-1',
      [{ _id: 'u2', surveyId: SURVEY_ID }],
    );
    // S's own earlier records are recovered natively (re-derivation) — we never
    // attempt a re-registration write.
    expect(services.account.write).toHaveBeenCalledTimes(1);
  });
});
