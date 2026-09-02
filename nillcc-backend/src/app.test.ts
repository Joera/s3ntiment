import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Express } from 'express';

// ---- Mocks (hoisted so the app module's own imports are intercepted before
// resolution). Keep the Node environment — no jsdom, no real Lit / NilDB /
// IPFS / Base RPC. We replace the unbuilt/gitignored contracts constants, the
// in-package NillionPkpClient, and viem's verifyMessage (used by the /score
// route) with hand-rolled fakes so the boundary-validation tests are offline
// and deterministic.

const h = vi.hoisted(() => ({
  clientInstances: [] as any[],
}));

vi.mock('s3ntiment-contracts/constants', () => ({
  S3NTIMENT_STORE: {
    address: '0xSurveyStore',
    abi: [{ name: 'isPoolMember', type: 'function' }],
  },
}));

vi.mock('viem', () => ({
  verifyMessage: vi.fn(async () => true),
}));

vi.mock('./services/nildb.pkp.service.js', () => ({
  NillionPkpClient: class {
    runQuery = vi.fn(async () => ({ 'node-1': 'run-1' }));
    readQueryResults = vi.fn(async () => 'combined-results');
    constructor(..._args: any[]) {
      h.clientInstances.push(this);
    }
  },
}));

import { createApp } from './app.js';
import { verifyMessage } from 'viem';

// ---- Ephemeral-server helper: bind the app to port 0, exercise it over real
// HTTP (Node's built-in fetch — no supertest dep), then tear it down.

async function withServer(app: Express, fn: (base: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface ReqResult {
  status: number;
  body: any;
}

async function send(
  method: string,
  base: string,
  path: string,
  body: unknown,
): Promise<ReqResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const post = (base: string, path: string, body: unknown) => send('POST', base, path, body);
const put = (base: string, path: string, body: unknown) => send('PUT', base, path, body);

// ---- Fake services — every service call is a vi.fn the tests can assert on.

function fakeDeps() {
  const pool = {
    create: vi.fn(async (body: any) => ({ pkpId: 'pkp-1', pkpDid: 'did:key:1', groupId: 'g-1' })),
    update: vi.fn(async () => undefined),
    registerBuilder: vi.fn(async () => ({ ok: true })),
  };
  const survey = {
    create: vi.fn(async () => 'QmSurveyCid'),
    update: vi.fn(async () => 'QmUpdatedCid'),
    get: vi.fn(async () => ({ id: 's1', title: 'T' })),
    score: vi.fn(async () => 42),
    getUserDelegation: vi.fn(async () => ({ delegation: 'del-1' })),
  };
  const viem = {
    read: vi.fn(async () => true),
    publicClient: { verifyMessage: vi.fn(async () => true) },
  };
  const lit = {};
  const litPoolKeys = {
    get: vi.fn(async () => 'usage-key-1'),
    set: vi.fn(),
  };
  return { pool, survey, viem, lit, litPoolKeys };
}

function makeApp() {
  const deps = fakeDeps();
  const app = createApp(deps);
  return { deps, app };
}

beforeEach(() => {
  vi.clearAllMocks();
  // restore the default verifyMessage implementation (clearAllMocks does not
  // reset implementations, so an auth test that flips it to false would leak).
  vi.mocked(verifyMessage).mockResolvedValue(true);
  h.clientInstances.length = 0;
});

// ====== POST /api/pools ======

describe('POST /api/pools — boundary validation', () => {
  it('400s with the historical "missing poolId" message and does NOT call the handler', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/pools', {
        signature: 'sig-1',
        userAddress: '0xUser',
        safeAddress: '0xSafe',
        // no poolId
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing poolId' });
      expect(deps.pool.create).not.toHaveBeenCalled();
    });
  });

  it('400s with the historical "missing safeAddress" message when safeAddress is absent', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/pools', {
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: '0xpool',
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing safeAddress' });
      expect(deps.pool.create).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when poolId is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/pools', {
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: 12345,
        safeAddress: '0xSafe',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('poolId must be a string');
      expect(deps.pool.create).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the handler (201)', async () => {
    const { deps, app } = makeApp();
    const body = {
      signature: 'sig-1',
      userAddress: '0xUser',
      poolId: '0xpool',
      safeAddress: '0xSafe',
    };
    await withServer(app, async (base) => {
      const res = await post(base, '/api/pools', body);
      expect(res.status).toBe(201);
      expect(deps.pool.create).toHaveBeenCalledTimes(1);
      expect(deps.pool.create).toHaveBeenCalledWith(body);
    });
  });
});

// ====== POST /api/surveys ======

describe('POST /api/surveys — boundary validation', () => {
  const valid = {
    signature: 'sig-1',
    userAddress: '0xUser',
    surveyConfig: { id: 'survey-1', pool: '0xpool', title: 'Coffee?' },
    poolConfig: { pkpId: 'pkp-1', pkpDid: 'did:key:pkp1', safe: '0xSafe', groupId: 'g-1' },
  };

  it('400s with MISSING_POOL_CONFIG when poolConfig is absent', async () => {
    const { deps, app } = makeApp();
    const { poolConfig, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys', rest);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_POOL_CONFIG');
      expect(res.body.message).toBe(
        'create-survey payload requires poolConfig with pkpId, pkpDid and safe',
      );
      expect(deps.survey.create).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_POOL_CONFIG when poolConfig lacks pkpId/pkpDid/safe', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys', {
        ...valid,
        poolConfig: { safe: '0xSafe' }, // imported-pool-ish partial config
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_POOL_CONFIG');
      expect(deps.survey.create).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_FIELD when a required top-level field is absent', async () => {
    const { deps, app } = makeApp();
    // signature/userAddress are now auth-covered (401 before validation), so a
    // missing surveyConfig is what reaches the boundary validator.
    const { surveyConfig, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing surveyConfig' });
      expect(deps.survey.create).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when surveyConfig is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys', { ...valid, surveyConfig: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('surveyConfig must be an object');
      expect(deps.survey.create).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the handler (201)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys', valid);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ cid: 'QmSurveyCid' });
      expect(deps.survey.create).toHaveBeenCalledTimes(1);
      expect(deps.survey.create).toHaveBeenCalledWith(valid);
    });
  });
});

// ====== PUT /api/surveys/:id ======

describe('PUT /api/surveys/:id — boundary validation', () => {
  const valid = {
    signature: 'sig-1',
    userAddress: '0xUser',
    survey: { id: 'survey-1', pool: '0xpool', groups: [], queryIds: ['q-1'] },
    poolConfig: { safe: '0xSafe' }, // deliberately NOT a full config (PR #38)
  };

  it('400s with SURVEY_ID_MISMATCH when body survey.id does not match the URL id', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await put(base, '/api/surveys/other-id', valid);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SURVEY_ID_MISMATCH');
      expect(deps.survey.update).not.toHaveBeenCalled();
    });
  });

  it('400s with SURVEY_ID_MISMATCH when survey is absent (preserved guard)', async () => {
    const { deps, app } = makeApp();
    const { survey, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await put(base, '/api/surveys/survey-1', rest);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SURVEY_ID_MISMATCH');
      expect(deps.survey.update).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_FIELD when survey is absent but survey.id present elsewhere', async () => {
    const { deps, app } = makeApp();
    const { survey, ...rest } = valid;
    const withOnlySurveyConfig = { ...rest, surveyConfig: { id: 'survey-1' } };
    await withServer(app, async (base) => {
      // surveyConfig is no longer the survey carrier — `survey` is missing, so
      // the id check (survey.id) also trips first.
      const res = await put(base, '/api/surveys/survey-1', withOnlySurveyConfig);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SURVEY_ID_MISMATCH');
      expect(deps.survey.update).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when poolConfig is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await put(base, '/api/surveys/survey-1', { ...valid, poolConfig: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('poolConfig must be an object');
      expect(deps.survey.update).not.toHaveBeenCalled();
    });
  });

  it('passes a valid partial-config payload through to the handler (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await put(base, '/api/surveys/survey-1', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cid: 'QmUpdatedCid' });
      expect(deps.survey.update).toHaveBeenCalledTimes(1);
      expect(deps.survey.update).toHaveBeenCalledWith(valid);
    });
  });
});

// ====== POST /api/surveys/:id/score ======

describe('POST /api/surveys/:id/score — boundary validation', () => {
  const valid = { signature: 'sig-1', signer: '0xRespondent', poolId: '0xpool' };

  it('400s with MISSING_FIELD when signature is absent', async () => {
    const { deps, app } = makeApp();
    const { signature, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/score', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing signature' });
      expect(deps.viem.read).not.toHaveBeenCalled();
      expect(deps.survey.score).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when signer is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/score', {
        ...valid,
        signer: 123,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('signer must be a string');
      expect(deps.survey.score).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the score handler (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/score', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ score: 42 });
      expect(deps.viem.read).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        'isPoolMember',
        ['0xpool', '0xRespondent'],
      );
      expect(deps.survey.score).toHaveBeenCalledWith('survey-1', '0xRespondent');
    });
  });
});

// ====== POST /api/surveys/:id/results ======

describe('POST /api/surveys/:id/results — boundary validation', () => {
  const valid = {
    auth: { signature: 'sig-1', userAddress: '0xUser' },
    survey: ['query-1'],
    poolId: '0xpool',
    poolConfig: { safe: '0xSafe' },
  };

  it('400s with MISSING_FIELD when poolId is absent', async () => {
    const { deps, app } = makeApp();
    const { poolId, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/results', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing poolId' });
      expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_FIELD when poolConfig.safe is absent (only safe required, not full config)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/results', {
        ...valid,
        poolConfig: { pkpId: 'pkp-1' }, // no safe — and that is all we demand
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing safe' });
      expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when survey (queryIds) is not an array', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/results', {
        ...valid,
        survey: 'query-1',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('survey must be an array');
      expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the PKP results flow (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/results', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ results: 'combined-results' });
      expect(deps.litPoolKeys.get).toHaveBeenCalledWith('0xpool');
      expect(h.clientInstances).toHaveLength(1);
      const client = h.clientInstances[0];
      expect(client.runQuery).toHaveBeenCalledWith(
        valid.auth,
        valid.survey,
        valid.poolConfig,
        'usage-key-1',
      );
      expect(client.readQueryResults).toHaveBeenCalledWith(
        valid.auth,
        valid.poolConfig,
        'usage-key-1',
        { 'node-1': 'run-1' },
      );
    });
  });
});

// ====== POST /api/surveys/:surveyId/delegation ======

describe('POST /api/surveys/:surveyId/delegation — boundary validation', () => {
  const valid = {
    userDid: 'did:key:user',
    signature: 'sig-1',
    userAddress: '0xUser',
    poolId: '0xpool',
    poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' },
  };

  it('400s with MISSING_FIELD when userDid is absent', async () => {
    const { deps, app } = makeApp();
    const { userDid, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing userDid' });
      expect(deps.survey.getUserDelegation).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_FIELD when poolConfig is absent entirely', async () => {
    const { deps, app } = makeApp();
    const { poolConfig, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', rest);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MISSING_FIELD');
      expect(deps.survey.getUserDelegation).not.toHaveBeenCalled();
    });
  });

  it('400s with MISSING_FIELD when poolConfig lacks pkpDid (write delegation needs it)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', {
        ...valid,
        poolConfig: { safe: '0xSafe', pkpId: 'pkp-1' },
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing pkpDid' });
      expect(deps.survey.getUserDelegation).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when userAddress is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', {
        ...valid,
        userAddress: 42,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(deps.survey.getUserDelegation).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the delegation handler (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ delegation: 'del-1' });
      expect(deps.survey.getUserDelegation).toHaveBeenCalledWith(
        valid.signature,
        valid.userAddress,
        valid.poolId,
        valid.poolConfig,
        'survey-1',
        valid.userDid,
      );
    });
  });
});

// ====== POST /api/builder/register ======

describe('POST /api/builder/register — boundary validation', () => {
  const valid = {
    signature: 'sig-1',
    userAddress: '0xUser',
    poolId: '0xpool',
    pkpId: 'pkp-1',
    pkpDid: 'did:key:pkp1',
    safeAddress: '0xSafe',
  };

  it('400s with MISSING_FIELD when pkpId is absent', async () => {
    const { deps, app } = makeApp();
    const { pkpId, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/builder/register', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing pkpId' });
      expect(deps.pool.registerBuilder).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when safeAddress is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/builder/register', { ...valid, safeAddress: 7 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('safeAddress must be a string');
      expect(deps.pool.registerBuilder).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the handler (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/builder/register', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(deps.pool.registerBuilder).toHaveBeenCalledTimes(1);
      expect(deps.pool.registerBuilder).toHaveBeenCalledWith(valid);
    });
  });
});

// ====== POST /api/lit/usage-key ======

describe('POST /api/lit/usage-key — boundary validation', () => {
  const valid = { userAddr: '0xUser', signature: 'sig-1', poolId: '0xpool' };

  it('400s with MISSING_FIELD when signature is absent', async () => {
    const { deps, app } = makeApp();
    const { signature, ...rest } = valid;
    await withServer(app, async (base) => {
      const res = await post(base, '/api/lit/usage-key', rest);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'MISSING_FIELD', message: 'missing signature' });
      expect(deps.viem.publicClient.verifyMessage).not.toHaveBeenCalled();
      expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
    });
  });

  it('400s with INVALID_FIELD_TYPE when poolId is the wrong type', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/lit/usage-key', { ...valid, poolId: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FIELD_TYPE');
      expect(res.body.message).toBe('poolId must be a string');
      expect(deps.litPoolKeys.get).not.toHaveBeenCalled();
    });
  });

  it('passes a valid payload through to the usage-key flow (200)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/lit/usage-key', valid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ apiKey: 'usage-key-1' });
      expect(deps.viem.publicClient.verifyMessage).toHaveBeenCalledWith({
        address: '0xUser',
        message: 'Request capability to decrypt',
        signature: 'sig-1',
      });
      expect(deps.litPoolKeys.get).toHaveBeenCalledWith('0xpool');
    });
  });
});

// ====== AUTH WIRING ======
//
// The mutating routes (pools, surveys create/update, results, delegation,
// builder/register) now run the verifySignature middleware before any side
// effect. score and lit/usage-key already verified signatures inline and are
// left untouched. Each route's happy-path suite above already proves a valid
// signature+address passes through to the handler; here we cover the two
// rejection branches (missing material -> 401, invalid signature -> 401) plus
// that the handler is never reached on either.

describe('AUTH — signature verification on mutating routes', () => {
  // A valid body for each wired route (signature + the address field the
  // middleware reads). `verifyMessage` is mocked true in this suite, so a
  // present signature/address always verifies.
  const cases: Array<{ name: string; method: string; path: string; valid: any }> = [
    {
      name: 'POST /api/pools',
      method: 'POST',
      path: '/api/pools',
      valid: { signature: 'sig-1', userAddress: '0xUser', poolId: '0xpool', safeAddress: '0xSafe' },
    },
    {
      name: 'POST /api/surveys',
      method: 'POST',
      path: '/api/surveys',
      valid: {
        signature: 'sig-1',
        userAddress: '0xUser',
        surveyConfig: { id: 'survey-1', pool: '0xpool' },
        poolConfig: { pkpId: 'pkp-1', pkpDid: 'did:key:1', safe: '0xSafe' },
      },
    },
    {
      name: 'PUT /api/surveys/:id',
      method: 'PUT',
      path: '/api/surveys/survey-1',
      valid: {
        signature: 'sig-1',
        userAddress: '0xUser',
        survey: { id: 'survey-1', pool: '0xpool', groups: [], queryIds: ['q-1'] },
        poolConfig: { safe: '0xSafe' },
      },
    },
    {
      name: 'POST /api/surveys/:id/results',
      method: 'POST',
      path: '/api/surveys/survey-1/results',
      valid: {
        auth: { signature: 'sig-1', userAddress: '0xUser' },
        survey: ['query-1'],
        poolId: '0xpool',
        poolConfig: { safe: '0xSafe' },
      },
    },
    {
      name: 'POST /api/surveys/:id/delegation',
      method: 'POST',
      path: '/api/surveys/survey-1/delegation',
      valid: {
        userDid: 'did:key:user',
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: '0xpool',
        poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' },
      },
    },
    {
      name: 'POST /api/builder/register',
      method: 'POST',
      path: '/api/builder/register',
      valid: {
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: '0xpool',
        pkpId: 'pkp-1',
        pkpDid: 'did:key:pkp1',
        safeAddress: '0xSafe',
      },
    },
  ];

  it.each(cases)(
    '401s with MISSING_SIGNATURE when $name has no signature/address, before any side effect',
    async ({ method, path, valid }) => {
      const { deps, app } = makeApp();
      await withServer(app, async (base) => {
        // results nests the auth material inside body.auth — strip it there too.
        const body = structuredClone(valid);
        const target = body.auth && typeof body.auth === 'object' ? body.auth : body;
        delete target.signature;
        delete target.userAddress;
        const res = await send(method, base, path, body);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('MISSING_SIGNATURE');
        // no service was reached
        expect(
          [
            deps.pool.create,
            deps.pool.registerBuilder,
            deps.survey.create,
            deps.survey.update,
            deps.survey.getUserDelegation,
            deps.litPoolKeys.get,
          ].every((fn) => !fn.mock.calls.length),
        ).toBe(true);
      });
    },
  );

  it.each(cases)(
    '401s with INVALID_SIGNATURE when $name carries an invalid signature, before any side effect',
    async ({ method, path, valid }) => {
      const { deps, app } = makeApp();
      // persistent false: delegation's middleware loops over two messages, so a
      // single once-false would let the second message verify through.
      vi.mocked(verifyMessage).mockResolvedValue(false);
      await withServer(app, async (base) => {
        const res = await send(method, base, path, valid);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_SIGNATURE');
        expect(
          [
            deps.pool.create,
            deps.pool.registerBuilder,
            deps.survey.create,
            deps.survey.update,
            deps.survey.getUserDelegation,
            deps.litPoolKeys.get,
          ].every((fn) => !fn.mock.calls.length),
        ).toBe(true);
      });
    },
  );

  it('passes a valid signed payload through POST /api/pools to the handler (201)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/pools', {
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: '0xpool',
        safeAddress: '0xSafe',
      });
      expect(res.status).toBe(201);
      expect(verifyMessage).toHaveBeenCalledWith({
        message: 'Request owner invocation',
        signature: 'sig-1',
        address: '0xUser',
      });
      expect(deps.pool.create).toHaveBeenCalledTimes(1);
    });
  });

  it('passes a valid signed delegation payload (verifying against the submit/migrate messages)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/delegation', {
        userDid: 'did:key:user',
        signature: 'sig-1',
        userAddress: '0xUser',
        poolId: '0xpool',
        poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' },
      });
      expect(res.status).toBe(200);
      // the middleware tries s3ntiment:submit first, then s3ntiment:migrate
      expect(verifyMessage).toHaveBeenNthCalledWith(1, {
        message: 's3ntiment:submit',
        signature: 'sig-1',
        address: '0xUser',
      });
      expect(deps.survey.getUserDelegation).toHaveBeenCalledTimes(1);
    });
  });

  it('passes a valid signed results payload (reading auth from body.auth)', async () => {
    const { deps, app } = makeApp();
    await withServer(app, async (base) => {
      const res = await post(base, '/api/surveys/survey-1/results', {
        auth: { signature: 'sig-1', userAddress: '0xUser' },
        survey: ['query-1'],
        poolId: '0xpool',
        poolConfig: { safe: '0xSafe' },
      });
      expect(res.status).toBe(200);
      expect(verifyMessage).toHaveBeenCalledWith({
        message: 'Request owner invocation',
        signature: 'sig-1',
        address: '0xUser',
      });
      expect(deps.litPoolKeys.get).toHaveBeenCalledWith('0xpool');
    });
  });
});
