import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// NillionPkpClient tests. The client talks to (a) Lit via this.lit.executeAction
// and (b) hardcoded nil-node REST endpoints via global fetch. We fake this.lit
// and mock global fetch, then assert the exact URL / method / headers / body and
// the response handling — no real network.
//
// The unbuilt shared barrel is mocked deterministically (compactAction,
// ownerInvocationAction, userDelegationAction, combineShares).

vi.mock('@s3ntiment/shared', () => ({
  combineShares: vi.fn((shares: any) => `combined:${shares.length}`),
  compactAction: vi.fn((a: any) => a),
  ownerInvocationAction: vi.fn(() => 'owner-invocation-action'),
  userDelegationAction: vi.fn(() => 'user-delegation-action'),
  tallyResults: vi.fn((d: any) => d),
}));

import { NillionPkpClient } from './nildb.pkp.service.js';
import { combineShares, compactAction } from '@s3ntiment/shared';

const POOL_ID = '0xpool123';
const SAFE = '0xSafE';
const CONTRACT = '0xContract';

function fakeLit(execImpl?: any) {
  return { executeAction: vi.fn(execImpl ?? (async () => ({ response: { invocation: 'inv-1' } }))) };
}

function mockFetch(impl: (url: string, init?: any) => any) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function client(lit: any = fakeLit()) {
  return new NillionPkpClient(lit, POOL_ID, SAFE, CONTRACT) as any;
}

function nodeDids(c: any): string[] {
  return (c.nodes as { did: string }[]).map((n) => n.did);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NillionPkpClient.registerAsBuilder', () => {
  it('posts to /v1/builders/register on every node with the invocation bearer token', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({ status: 201 }));

    const results = await c.registerAsBuilder('sig', '0xUser', 'pkp1', 'did:key:pkp1', 'uk');

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const first = fetchFn.mock.calls[0];
    expect(first[0]).toBe('https://nildb-stg-n1.nillion.network/v1/builders/register');
    expect(first[1].method).toBe('POST');
    expect(first[1].headers['Content-Type']).toBe('application/json');
    expect(first[1].headers['Authorization']).toBe('Bearer inv-1');
    expect(JSON.parse(first[1].body)).toEqual({ did: 'did:key:pkp1', name: 'S3ntiment PKP' });

    // Keys per node did, with the REST status echoed.
    const dids = nodeDids(c);
    expect(Object.keys(results).sort()).toEqual([...dids].sort());
    expect(Object.values(results)).toEqual([201, 201, 201]);
  });

  it('returns undefined when an invocation is undefined (invocation failed)', async () => {
    const lit = fakeLit(async () => ({ response: { } }));
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({ status: 201 }));

    const results = await c.registerAsBuilder('sig', '0xUser', 'pkp1', 'did', 'uk');
    expect(results).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(lit.executeAction).toHaveBeenCalledTimes(1);
  });
});

describe('NillionPkpClient.createCollection', () => {
  it('posts to /v1/collections and parses the JSON body per node', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({ status: 201, text: async () => '{"id":"c1"}' }));

    const collectionData = { name: 's', schema: { x: 1 } };
    const results = await c.createCollection('sig', '0xUser', 'pkp1', 'did', 'uk', collectionData);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const first = fetchFn.mock.calls[0];
    expect(first[0]).toBe('https://nildb-stg-n1.nillion.network/v1/collections');
    expect(first[1].method).toBe('POST');
    expect(first[1].headers['Authorization']).toBe('Bearer inv-1');
    expect(JSON.parse(first[1].body)).toEqual(collectionData);

    const dids = nodeDids(c);
    expect(results[dids[0]]).toEqual({ status: 201, data: { id: 'c1' } });
  });
});

describe('NillionPkpClient.createQuery', () => {
  it('posts to /v1/queries and parses the JSON response', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({ status: 201, text: async () => '{"qid":"q1"}' }));

    const queryData = { _id: 'query-1', type: 'aggregation' };
    const results = await c.createQuery('sig', '0xUser', 'pkp1', 'did', 'uk', queryData);

    const first = fetchFn.mock.calls[0];
    expect(first[0]).toBe('https://nildb-stg-n1.nillion.network/v1/queries');
    expect(first[1].method).toBe('POST');
    expect(JSON.parse(first[1].body)).toEqual(queryData);

    const dids = nodeDids(c);
    expect(results[dids[0]]).toEqual({ status: 201, data: { qid: 'q1' } });
  });
});

describe('NillionPkpClient.runQuery', () => {
  it('posts to /v1/queries/run with the query id and returns per-node run ids', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({ json: async () => ({ data: 'runId-1' }) }));

    const runIds = await c.runQuery(
      { signature: 'sig', userAddress: '0xUser' },
      ['query-1'],
      { pubKey: 'k' },
      'usage-key',
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const first = fetchFn.mock.calls[0];
    expect(first[0]).toBe('https://nildb-stg-n1.nillion.network/v1/queries/run');
    expect(first[1].method).toBe('POST');
    expect(first[1].headers['Authorization']).toBe('Bearer inv-1');
    expect(JSON.parse(first[1].body)).toEqual({ _id: 'query-1', variables: {} });

    const dids = nodeDids(c);
    expect(runIds[dids[0]]).toBe('runId-1');
    expect(lit.executeAction).toHaveBeenCalledTimes(3);
  });
});

describe('NillionPkpClient.readQueryResults', () => {
  it('GETs /v1/queries/run/:runId for completed nodes and combines shares', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({
      json: async () => ({ data: { status: 'complete', result: { v: 1 } } }),
    }));

    const dids = nodeDids(c);
    const runIds = Object.fromEntries(dids.map((d) => [d, `run-${d}`]));

    const result = await c.readQueryResults(
      { signature: 'sig', userAddress: '0xUser' },
      { pubKey: 'k' },
      'usage-key',
      runIds,
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const first = fetchFn.mock.calls[0];
    expect(first[0]).toBe(`https://nildb-stg-n1.nillion.network/v1/queries/run/run-${dids[0]}`);
    expect(first[1].method).toBeUndefined(); // GET has no method set
    expect(first[1].headers['Authorization']).toBe('Bearer inv-1');

    // All three nodes reported 'complete' -> 3 shares combined.
    expect(combineShares).toHaveBeenCalledWith(expect.any(Array));
    expect(result).toBe('combined:3');
  });

  it('passes only completed nodes to combineShares (ignores incomplete)', async () => {
    const lit = fakeLit();
    const c = client(lit);
    const fetchFn = mockFetch(async () => ({
      json: async () => ({ data: { status: 'pending', result: undefined } }),
    }));

    const dids = nodeDids(c);
    const runIds = Object.fromEntries(dids.map((d) => [d, `run-${d}`]));

    const result = await c.readQueryResults(
      { signature: 'sig', userAddress: '0xUser' },
      { pubKey: 'k' },
      'usage-key',
      runIds,
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result).toBe('combined:0');
  });
});

describe('NillionPkpClient.getUserWriteDelegation', () => {
  it('executes the user-delegation action and returns the delegation token', async () => {
    const lit = fakeLit(async () => ({ response: { delegation: 'del-token' } }));
    const c = client(lit);

    const result = await c.getUserWriteDelegation(
      'sig',
      '0xUser',
      'survey-1',
      'did:key:user',
      POOL_ID,
      'usage-key',
      'pkp1',
      'did:key:pkp1',
    );

    expect(compactAction).toHaveBeenCalled();
    expect(lit.executeAction).toHaveBeenCalledTimes(1);
    const [poolId, code, params, usageKey] = lit.executeAction.mock.calls[0];
    expect(poolId).toBe(POOL_ID);
    expect(code).toBe('user-delegation-action');
    expect(usageKey).toBe('usage-key');
    expect(params).toMatchObject({
      signature: 'sig',
      userAddress: '0xUser',
      pkpId: 'pkp1',
      pkpDid: 'did:key:pkp1',
      userDid: 'did:key:user',
      collectionId: 'survey-1',
    });
    expect(result).toEqual({ delegation: 'del-token' });
  });
});
