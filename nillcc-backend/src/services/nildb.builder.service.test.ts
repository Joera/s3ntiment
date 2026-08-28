import { describe, it, expect, vi, beforeEach } from 'vitest';

// NilDBBuilderService tests. The module reads VITE_NIL_BUILDER_PRIVATE_KEY and
// VITE_NILDB_NODES at module load — test/setup.ts guarantees benign values so
// construction does not throw. The unbuilt shared barrel is mocked for
// determinism; the builder's NilDB collaborators are injected as fakes.
//
// NOTE: the ecies encryptToBuilder/decryptFromBuilder helpers are exercised
// against a real local signer key (no network — getDid() is local derivation).

vi.mock('@s3ntiment/shared', () => ({
  tallyResults: vi.fn((data: any, _groups: any) => data),
}));

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
