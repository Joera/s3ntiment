import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (hoisted so the controller's own imports are intercepted before
// resolution). Keep the Node environment and mock the unbuilt shared barrel
// plus the in-package NillionPkpClient — no real Lit / NilDB / network.

const h = vi.hoisted(() => ({
  clientInstances: [] as any[],
}));

vi.mock('@s3ntiment/shared', () => ({
  compactAction: vi.fn((a: any) => a),
  encryptAction: 'encrypt-action',
  getDecryptForOwnerAction: vi.fn(() => 'decrypt-owner'),
  getDecryptForRespondentAction: vi.fn(() => 'decrypt-member'),
  getPkpPublicKeyAction: 'get-public-key-action',
  ownerInvocationAction: vi.fn(() => 'owner-invocation'),
  publicKeyToDidKey: vi.fn(() => 'did:key:pkp'),
  userDelegationAction: vi.fn(() => 'user-delegation'),
}));

vi.mock('./services/nildb.pkp.service.js', () => ({
  NillionPkpClient: class {
    registerAsBuilder = vi.fn(async () => ({ registered: true }));
    constructor(..._args: any[]) {
      h.clientInstances.push(this);
    }
  },
}));

import { PoolController } from './pool.ctrlr.js';
import { compactAction, publicKeyToDidKey } from '@s3ntiment/shared';

const POOL_ID = '0xpool123';

function fakeDeps() {
  const lit = {
    createPkp: vi.fn(async () => 'pkp-address'),
    getActionCid: vi.fn(async (a: any) => `cid:${String(a)}`),
    registerAction: vi.fn(async (cid: any, name: any) => ({ hashedCid: `h:${name}` })),
    // The REAL Lit SDK returns group_id as a NUMBER. Stubbing it as a string
    // here would mask the producer's real output type and keep the suite green
    // even though the FE zod contract requires groupId to be a string. Use a
    // number so the regression actually bites.
    createGroup: vi.fn(async (..._args: any[]) => ({ group_id: 12345 })),
    createUsageKey: vi.fn(async () => ({ usage_api_key: 'usage-key-1' })),
    executeAction: vi.fn(async () => ({
      response: { publicKey: '0xPubKey' },
    })),
  };
  const litPoolKeys = {
    get: vi.fn(async () => 'usage-key-1'),
    set: vi.fn(),
  };
  const nillDB = {};
  return { lit, litPoolKeys, nillDB };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.clientInstances.length = 0;
});

describe('PoolController.create', () => {
  it('creates a PKP, registers actions, builds a group + usage key (happy path)', async () => {
    const deps = fakeDeps();
    const ctrl = new PoolController(deps.lit, deps.litPoolKeys, deps.nillDB);
    const body = {
      signature: 'sig-1',
      userAddress: '0xUser',
      poolId: POOL_ID,
      safeAddress: '0xSafE',
    };

    const result = await ctrl.create(body);

    // PKP + 4 action CIDs + getPublicKey + user-delegation = 7 parallel ops.
    expect(deps.lit.createPkp).toHaveBeenCalledTimes(1);
    expect(deps.lit.getActionCid).toHaveBeenCalledTimes(6);
    expect(compactAction).toHaveBeenCalled();

    // Six actions registered (encrypt + 4 pool-specific + get-public-key).
    expect(deps.lit.registerAction).toHaveBeenCalledTimes(6);

    // Group created with the PKP address and all hashed action cids.
    expect(deps.lit.createGroup).toHaveBeenCalledTimes(1);
    const groupArgs = deps.lit.createGroup.mock.calls[0];
    expect(groupArgs[2]).toContain('pkp-address');
    expect(groupArgs[3]).toHaveLength(6);

    // Usage key derived and persisted for the pool.
    expect(deps.lit.createUsageKey).toHaveBeenCalledTimes(1);
    expect(deps.litPoolKeys.set).toHaveBeenCalledWith(POOL_ID, 'usage-key-1');

    expect(deps.lit.executeAction).toHaveBeenCalledTimes(1);
    expect(publicKeyToDidKey).toHaveBeenCalledWith('0xPubKey');

    // groupId is normalized to a string at the producer boundary even though
    // the mocked Lit SDK returned a NUMBER (12345).
    expect(result).toEqual({ pkpId: 'pkp-address', pkpDid: 'did:key:pkp', groupId: '12345' });
    expect(result.groupId).toBe('12345');
  });

  it('returns a missing-poolId string and does no work when poolId is absent (400-class guard)', async () => {
    const deps = fakeDeps();
    const ctrl = new PoolController(deps.lit, deps.litPoolKeys, deps.nillDB);
    const result = await ctrl.create({ signature: 'sig', userAddress: 'ua', safeAddress: '0xSafE' });
    expect(result).toBe('missing poolId');
    expect(deps.lit.createPkp).not.toHaveBeenCalled();
  });

  it('returns a missing-safeAddress string when safeAddress is absent', async () => {
    const deps = fakeDeps();
    const ctrl = new PoolController(deps.lit, deps.litPoolKeys, deps.nillDB);
    const result = await ctrl.create({ signature: 'sig', userAddress: 'ua', poolId: POOL_ID });
    expect(result).toBe('missing safeAddress');
    expect(deps.lit.createPkp).not.toHaveBeenCalled();
  });
});

describe('PoolController.update', () => {
  it('is currently a no-op — resolves undefined and performs no work', async () => {
    const deps = fakeDeps();
    const ctrl = new PoolController(deps.lit, deps.litPoolKeys, deps.nillDB);

    const result = await ctrl.update({ survey: {}, poolConfig: {} });

    expect(result).toBeUndefined();
    expect(deps.lit.createPkp).not.toHaveBeenCalled();
    expect(deps.lit.executeAction).not.toHaveBeenCalled();
    expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
  });
});

describe('PoolController.registerBuilder', () => {
  it('registers the PKP as a builder via a NillionPkpClient and returns { ok: true }', async () => {
    const deps = fakeDeps();
    const ctrl = new PoolController(deps.lit, deps.litPoolKeys, deps.nillDB);
    const body = {
      signature: 'sig-1',
      userAddress: '0xUser',
      poolId: POOL_ID,
      pkpId: 'pkp-1',
      pkpDid: 'did:key:pkp1',
      safeAddress: '0xSafE',
    };

    const result = await ctrl.registerBuilder(body);

    expect(deps.litPoolKeys.get).toHaveBeenCalledWith(POOL_ID);
    expect(h.clientInstances.length).toBe(1);
    const client = h.clientInstances[0];
    expect(client.registerAsBuilder).toHaveBeenCalledWith(
      'sig-1',
      '0xUser',
      'pkp-1',
      'did:key:pkp1',
      'usage-key-1',
      `builder-${POOL_ID}`,
    );
    expect(result).toEqual({ ok: true });
  });
});
