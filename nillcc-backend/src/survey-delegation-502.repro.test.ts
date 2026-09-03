// Regression tests for the respondent-delegation 502 incident
// (brain/audits/survey-delegation-502-lit-403-2026-09-03.md).
//
// Three stacked bugs made POST /api/surveys/:surveyId/delegation return nginx
// 502:
//   [A] the route had no try/catch and the backend had no global error handling,
//       so an upstream throw (Lit 403) became an unhandled rejection that killed
//       the Node process;
//   [B] getUserDelegation built the PKP client with `survey.poolId` parsed from
//       the IPFS config — a field the create() path never writes (the config
//       carries `pool`, no `poolId`) — so the client's pool identity was
//       `undefined` and the delegation action code baked in
//       isPoolMember('undefined', ...);
//   [C] the 403 was the byte-exact unixfs CID of that `'undefined'`-poolId code,
//       which no usage key permits.
//
// These tests go GREEN after FIX A (route try/catch + 500 DELEGATION_FAILED),
// FIX B (client sourced from the REQUEST poolId), and the [C] canary pins the
// action-code mechanism that cleared the 403.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Express } from 'express';

// Real shared action source (pure leaf modules, no Lit/Nillion graph) — the
// [C] canary builds the exact delegation action code the backend ships.
import { userDelegationAction } from '../../shared/src/shared/lit/actions/user-delegation.ts';
import { compactAction } from '../../shared/src/shared/lit/actions/helpers.ts';

// ---- Mocks (hoisted so the app/controller module graphs are intercepted before
// resolution). Keep the Node environment: no jsdom, no real Lit / NilDB / IPFS /
// Base RPC. `@s3ntiment/shared` is unbuilt/gitignored, so the controller's bare
// import is replaced (same approach as survey.ctrlr.test.ts); the in-package
// NillionPkpClient is replaced with a fake that records constructor args.

const h = vi.hoisted(() => ({
  // Every NillionPkpClient constructed by the controller — [0][1] is the poolId
  // slot of the first client.
  clientCtorArgs: [] as any[][],
  fetchSurveyAndParseCid: vi.fn(),
}));

vi.mock('s3ntiment-contracts/constants', () => ({
  S3NTIMENT_STORE: {
    address: '0xSurveyStore',
    abi: [{ name: 'getSurvey', type: 'function' }],
  },
}));

vi.mock('viem', () => ({
  verifyMessage: vi.fn(async () => true),
}));

vi.mock('@s3ntiment/shared', () => ({
  stripScoring: vi.fn((s: any) => ({
    safeConfigWithScoring: s,
    safeConfig: s,
    scoring: { scored: true },
  })),
  isScored: vi.fn((_groups: any) => true),
  createSurveyCollectionSchema: vi.fn(() => ({ name: 'n', type: 't', schema: {} })),
  createSurveyAggregationQuery: vi.fn((id: any) => ({ _id: `query-${id}` })),
  fetchSurveyAndParseCid: h.fetchSurveyAndParseCid,
  calculateScore: vi.fn(() => 42),
  withRetry: vi.fn(async (fn: any) => fn()),
}));

vi.mock('./services/nildb.pkp.service.js', () => ({
  NillionPkpClient: class {
    getUserWriteDelegation = vi.fn(async () => ({ delegation: 'del-1' }));
    constructor(...args: any[]) {
      h.clientCtorArgs.push(args);
    }
  },
}));

import { createApp } from './app.js';
import { SurveyController } from './survey.ctrlr.js';

// ---- Ephemeral-server helper (real HTTP over port 0, no supertest dep).

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

// Body that passes validateDelegation (poolId + poolConfig.{safe,pkpId,pkpDid}
// are all required).
const VALID = {
  userDid: 'did:key:user',
  signature: 'sig-1',
  userAddress: '0xUser',
  poolId: '404eabf1-8deb-45be-a458-2502a1889157',
  poolConfig: { safe: '0xSafe', pkpId: 'pkp-1', pkpDid: 'did:key:pkp1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.clientCtorArgs.length = 0;
});

// ====== [A] route-level: an upstream throw degrades to a 500 JSON, never a
// crash/hang. RED before FIX A (unhandled rejection + aborted request), GREEN
// after (handler mirrors /results and returns 500 DELEGATION_FAILED).

describe('[A] delegation route 500-on-throw', () => {
  it('returns 500 {error:DELEGATION_FAILED, detail} and still responds when the upstream Lit call throws a 403', async () => {
    const survey = {
      getUserDelegation: vi.fn(async () => {
        throw new Error(
          'HTTP 403: The provided API key is not authorized to execute the specified action (QmdQUdr69FvH5FgZRPF5bJYg41LLrENKHaW5ha8o5pRk7s)',
        );
      }),
    };
    const app = createApp({ pool: {}, survey, viem: {}, lit: {}, litPoolKeys: {} } as any);

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/surveys/survey-1/delegation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(VALID),
        signal: AbortSignal.timeout(5000),
      });
      // The route must respond (not hang / unhandled-reject the process).
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('DELEGATION_FAILED');
      expect(String(body.detail)).toContain('403');
      expect(survey.getUserDelegation).toHaveBeenCalledTimes(1);
    });
  });
});

// ====== [B] controller-level: the PKP client is built with the REQUEST poolId,
// even when the parsed EncryptedConfig (create-path shape) carries `pool` and
// NO `poolId` key. RED before FIX B (client poolId slot = undefined), GREEN
// after (survey.ctrlr.ts uses the request param).

describe('[B] getUserDelegation sources poolId from the request', () => {
  it('builds the PKP client with the REQUEST poolId even when the parsed EncryptedConfig carries NO poolId', async () => {
    // create()-path config: `...surveyConfig` spreads the Survey object which
    // carries `pool` and no `poolId` (only update() writes poolId).
    h.fetchSurveyAndParseCid.mockResolvedValue({
      id: 'survey-abc',
      pool: VALID.poolId,
      encryptedForOwner: { ciphertext: 'c', dataToEncryptHash: 'h' },
      encryptedForRespondent: { ciphertext: 'c', dataToEncryptHash: 'h' },
      encryptedScoring: 'b64',
      isScored: true,
    });

    const litPoolKeys = { get: vi.fn(async () => 'usage-key-1') };
    const ctrl = new SurveyController(
      {} as any,
      {} as any,
      litPoolKeys as any,
      {} as any,
      {} as any,
    );

    await ctrl.getUserDelegation(
      'sig-1',
      '0xUser',
      VALID.poolId,
      VALID.poolConfig,
      'survey-abc',
      'did:key:user',
    );

    expect(litPoolKeys.get).toHaveBeenCalledWith(VALID.poolId);
    expect(h.clientCtorArgs.length).toBe(1);
    // The NillionPkpClient poolId slot must be the REQUEST poolId, not the
    // config-derived `undefined`.
    expect(h.clientCtorArgs[0][1]).toBe(VALID.poolId);
    expect(h.clientCtorArgs[0][1]).not.toBeUndefined();
  });
});

// ====== [C] canary: the delegation action code the client would send to Lit
// bakes the real poolId into isPoolMember — the fixed variant is the one whose
// unixfs CID the usage key permits; the `'undefined'` variant is the 403.

describe('[C] built action code carries the real poolId', () => {
  it('produces isPoolMember("<poolId>", userAddress), not the literal "undefined"', () => {
    const contract = '0xSurveyStore';
    // Fixed path (request poolId) — the permitted CID.
    expect(compactAction(userDelegationAction(VALID.poolId, contract))).toContain(
      `isPoolMember('${VALID.poolId}', userAddress)`,
    );
    // Buggy path (survey.poolId === undefined) — the 403 string.
    expect(compactAction(userDelegationAction(undefined as any, contract))).toContain(
      "isPoolMember('undefined', userAddress)",
    );
  });
});
