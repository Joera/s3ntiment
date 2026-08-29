import { describe, it, expect, vi, beforeEach } from 'vitest';

// NilDBBuilderService tests. The module reads VITE_NIL_BUILDER_PRIVATE_KEY and
// VITE_NILDB_NODES at module load — test/setup.ts guarantees benign values so
// construction does not throw. The unbuilt shared barrel is mocked for
// determinism; the builder's NilDB collaborators are injected as fakes.
//
// NOTE: the ecies encryptToBuilder/decryptFromBuilder helpers are exercised
// against a real local signer key (no network — getDid() is local derivation).

vi.mock('@s3ntiment/shared', async () => {
  // The service imports tallyResults from the unbuilt @s3ntiment/shared barrel
  // (whose index pulls browser-only deps). To exercise the REAL tally algorithm
  // through findSurveyResults without the whole barrel, we wire the mocked
  // barrel's tallyResults to the shared leaf module imported directly by its
  // relative source path — the same leaf-import discipline as the seam tests.
  const { tallyResults } = await import('../../../shared/src/shared/results/tabulate.js');
  return { tallyResults };
});

// Direct leaf import for cross-checking findSurveyResults' output against the
// real tabulation algorithm, independent of the whole-barrel mock.
import { tallyResults as realTallyResults } from '../../../shared/src/shared/results/tabulate.js';
import { NilDBBuilderService } from './nildb.builder.service.js';

async function makeService() {
  // Real construction against the setup-provided env key (local, no network).
  const svc: any = new NilDBBuilderService();
  svc.builderDid = await svc.builderSigner.getDid();
  return svc;
}

function fakeBuilderClient(overrides: Record<string, any> = {}) {
  return {
    readProfile: vi.fn(async () => ({ profile: 'p' })),
    readCollection: vi.fn(async () => ({ collection: 'c' })),
    createCollection: vi.fn(async () => ({ ok: true })),
    createStandardData: vi.fn(async () => ({ created: true })),
    deleteData: vi.fn(async () => ({ deleted: true })),
    findData: vi.fn(async () => ({ data: [] })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NilDBBuilderService.encryptToBuilder / decryptFromBuilder', () => {
  it('round-trips structured data through ecies using the builder key+did', async () => {
    const svc = await makeService();

    const payload = { scoring: { q1: 2, q2: 1 }, groups: [{ id: 'g1' }] };
    const encrypted = svc.encryptToBuilder(payload);

    // Encrypted output is a base64 string of the ecies ciphertext.
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = svc.decryptFromBuilder(encrypted);
    expect(decrypted).toEqual(payload);
  });
});

describe('NilDBBuilderService (injected builder client)', () => {
  it('constructs without throwing when env provides a builder key/nodes', async () => {
    const svc = await makeService();
    expect(svc.builderKey).toBeTruthy();
    expect(svc.builderDid?.didString).toMatch(/^did:key:/);
  });

  it('exists() returns the list of doc ids when rows are found', async () => {
    const svc = await makeService();
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => ({ data: [{ _id: 'd1' }, { _id: 'd2' }] })),
    });

    const result = await svc.exists('survey-1', '0xUser');
    expect(svc.builderClient.findData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: { signer: '0xUser' },
    });
    expect(result).toEqual(['d1', 'd2']);
  });

  it('exists() returns false when no rows are found', async () => {
    const svc = await makeService();
    svc.builderClient = fakeBuilderClient();
    const result = await svc.exists('survey-1', '0xUser');
    expect(result).toBe(false);
  });

  it('getResponseById() returns the first matching row', async () => {
    const svc = await makeService();
    const row = { _id: 'd1', answer: 'a' };
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => ({ data: [row] })),
    });

    const result = await svc.getResponseById('survey-1', 'd1');
    expect(svc.builderClient.findData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: { _id: 'd1' },
    });
    expect(result).toBe(row);
  });

  it('createSurveyCollection() forwards the schema and returns the id', async () => {
    const svc = await makeService();
    svc.builderClient = fakeBuilderClient();
    const rawSchema = { name: 's', type: 'cat', schema: { x: 1 } };

    const result = await svc.createSurveyCollection('survey-1', rawSchema);
    expect(svc.builderClient.createCollection).toHaveBeenCalledWith({
      _id: 'survey-1',
      name: 's',
      type: 'cat',
      schema: { x: 1 },
    });
    expect(result).toBe('survey-1');
  });

  it('getCollectionInfo() returns the collection or null on error', async () => {
    const okSvc = await makeService();
    okSvc.builderClient = fakeBuilderClient();
    expect(await okSvc.getCollectionInfo('c1')).toEqual({ collection: 'c' });

    const errSvc = await makeService();
    errSvc.builderClient = fakeBuilderClient({
      readCollection: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await errSvc.getCollectionInfo('c1')).toBeNull();
  });
});

describe('NilDBBuilderService.submitResponseForUser (idempotent replace)', () => {
  it('deletes existing docs for the signer, then creates the standard data (replace flow)', async () => {
    const svc = await makeService();
    const deleteData = vi.fn(async () => ({ deleted: true }));
    const createStandardData = vi.fn(async () => ({ created: true, id: 'n1' }));
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => ({ data: [{ _id: 'd1' }, { _id: 'd2' }] })),
      deleteData,
      createStandardData,
    });

    const userData = { signer: '0xUser', q1: 'a' };
    const result = await svc.submitResponseForUser('survey-1', userData);

    expect(svc.builderClient.findData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: { signer: '0xUser' },
    });
    expect(deleteData).toHaveBeenCalledTimes(2);
    expect(deleteData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: { _id: 'd1' },
    });
    expect(deleteData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: { _id: 'd2' },
    });
    expect(createStandardData).toHaveBeenCalledWith({
      collection: 'survey-1',
      data: [userData],
    });
    expect(result).toEqual({ created: true, id: 'n1' });
  });

  it('skips deletion and only creates the standard data when no prior docs exist', async () => {
    const svc = await makeService();
    const deleteData = vi.fn(async () => ({ deleted: true }));
    const createStandardData = vi.fn(async () => ({ created: true }));
    svc.builderClient = fakeBuilderClient({ deleteData, createStandardData });

    const userData = { signer: '0xFresh', q1: 'b' };
    const result = await svc.submitResponseForUser('survey-1', userData);

    expect(deleteData).not.toHaveBeenCalled();
    expect(createStandardData).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: true });
  });

  it('rethrows when createStandardData fails (after logging the error)', async () => {
    const svc = await makeService();
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => ({ data: [] })),
      createStandardData: vi.fn(async () => {
        throw new Error('nildb down');
      }),
    });

    await expect(svc.submitResponseForUser('survey-1', { signer: '0xUser' })).rejects.toThrow(
      'nildb down',
    );
  });
});

describe('NilDBBuilderService delegation issuance', () => {
  it('delegateCollectionToPkp() issues a signed NUC delegation for the per-collection create command', async () => {
    const svc = await makeService();
    const pkpDid = svc.builderDid.didString;

    const delegation = await svc.delegateCollectionToPkp('coll-123', pkpDid);

    expect(typeof delegation).toBe('string');
    const parts = delegation.split('.');
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.cmd).toBe('/nil/db/coll-123/data/create');
    expect(payload.aud).toBe(pkpDid);
    expect(payload.sub).toBe(svc.builderDid.didString);
    // 28-day expiry lands strictly in the future.
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('getOwnerReadDelegation() currently rejects: the 365-day expiry exceeds the NUC max lifetime (~28 days)', async () => {
    const svc = await makeService();
    // Pins real current behavior — NUC enforces a maximum delegation lifetime
    // and rejects `expiresIn(365 * 24 * 3600_000)`. See report for the latent bug.
    await expect(svc.getOwnerReadDelegation(svc.builderDid, 'survey-1')).rejects.toThrow(
      /maximum lifetime/,
    );
  });
});

describe('NilDBBuilderService.findSurveyResults (real tally)', () => {
  const radioGroups = [
    {
      id: 'g1',
      title: 'G',
      questions: [{ id: 'q1', question: 'Q?', type: 'radio', options: ['a', 'b'], required: true }],
    },
  ] as any;

  it('tallies raw findings through the real shared tabulate algorithm', async () => {
    const svc = await makeService();
    svc.findResultsDelay = 0; // skip the production 5s settle delay
    const rawData = [{ q1: 'a' }, { q1: 'b' }, { q1: 'a' }];
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => ({ data: rawData })),
    });

    const result = await svc.findSurveyResults('survey-1', radioGroups, {});

    expect(svc.builderClient.findData).toHaveBeenCalledWith({
      collection: 'survey-1',
      filter: {},
    });
    // Output equals the directly-imported leaf tally — the whole-barrel mock is
    // NOT the source of this assertion.
    expect(result).toEqual(realTallyResults(rawData, radioGroups));
    expect(result.q1.counts).toEqual({ a: 2, b: 1 });
    expect(result.q1.total).toBe(3);
  });

  it('answers { result: false } when findData rejects', async () => {
    const svc = await makeService();
    svc.findResultsDelay = 0;
    svc.builderClient = fakeBuilderClient({
      findData: vi.fn(async () => {
        throw new Error('find boom');
      }),
    });

    const result = await svc.findSurveyResults('survey-1', radioGroups, {});
    expect(result).toEqual({ result: false });
  });
});
