import { describe, it, expect, vi, beforeEach } from 'vitest';

// bootstrap.factory.ts sources its CSPRNG from viem/accounts generatePrivateKey
// (noble-secp256k1 randomPrivateKey -> webcrypto). We mock it to assert the
// load-or-create + persist contract deterministically; localStorage (installed by
// test/setup.ts) is reset to a fresh in-memory map per test.
vi.mock('viem/accounts', () => ({
  generatePrivateKey: vi.fn(),
}));

import { generatePrivateKey } from 'viem/accounts';
import {
  ensureBootstrapKey,
  createAndPersistBootstrapKey,
} from './bootstrap.factory.js';
import {
  loadBootstrapKeyFromStorage,
  BOOTSTRAP_STORAGE_KEY,
} from './state/storage.js';

// A well-formed 32-byte (64 hex char) 0x-prefixed private key.
const GENERATED_KEY = `0x${'ab'.repeat(32)}`;
const PERSISTED_KEY = `0x${'cd'.repeat(32)}`;
const SIGNER_ADDR = '0x00000000000000000000000000000000000000aa';

function installFreshLocalStorage() {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installFreshLocalStorage();
  (generatePrivateKey as any).mockReturnValue(GENERATED_KEY);
});

describe('ensureBootstrapKey — random bootstrap leaf (load-or-create)', () => {
  it('with no persisted key: generates a CSPRNG key, persists it immediately, and sets the signer', async () => {
    const updateSignerWithKey = vi.fn().mockResolvedValue(SIGNER_ADDR);
    const services = {
      account: {
        updateSignerWithKey,
        getSignerAddress: vi.fn(() => SIGNER_ADDR),
      },
    } as any;

    const address = await ensureBootstrapKey(services);

    expect(address).toBe(SIGNER_ADDR);
    // generated because nothing on disk
    expect(generatePrivateKey).toHaveBeenCalledTimes(1);
    // persisted at generation (RFC §7.1)
    expect(localStorage.getItem(BOOTSTRAP_STORAGE_KEY)).toBe(GENERATED_KEY);
    // fed to the smart-account signer (permissionless.simple.service updateSignerWithKey)
    expect(updateSignerWithKey).toHaveBeenCalledWith(GENERATED_KEY);
  });

  it('with a persisted key: reuses it (no regeneration) and sets the signer from it', async () => {
    // pre-existing bootstrap leaf from a prior visit
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, PERSISTED_KEY);

    const updateSignerWithKey = vi.fn().mockResolvedValue(SIGNER_ADDR);
    const services = {
      account: {
        updateSignerWithKey,
        getSignerAddress: vi.fn(() => SIGNER_ADDR),
      },
    } as any;

    const address = await ensureBootstrapKey(services);

    expect(address).toBe(SIGNER_ADDR);
    expect(generatePrivateKey).not.toHaveBeenCalled();
    expect(updateSignerWithKey).toHaveBeenCalledWith(PERSISTED_KEY);
    // the persisted value is untouched
    expect(localStorage.getItem(BOOTSTRAP_STORAGE_KEY)).toBe(PERSISTED_KEY);
  });

  it('treats a malformed persisted value as absent and regenerates (persisting the fresh key)', async () => {
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, 'not-a-valid-key');

    const services = {
      account: {
        updateSignerWithKey: vi.fn().mockResolvedValue(SIGNER_ADDR),
        getSignerAddress: vi.fn(() => SIGNER_ADDR),
      },
    } as any;

    await ensureBootstrapKey(services);

    expect(generatePrivateKey).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(BOOTSTRAP_STORAGE_KEY)).toBe(GENERATED_KEY);
  });

  it('persists the generated key even if setting the signer fails (RFC §7.1 — never orphan on tab close)', async () => {
    const services = {
      account: {
        updateSignerWithKey: vi.fn().mockRejectedValue(new Error('signer failed')),
        getSignerAddress: vi.fn(() => '0x'),
      },
    } as any;

    await expect(ensureBootstrapKey(services)).rejects.toThrow('signer failed');

    // the leaf was written to storage at generation, before the failed signer swap
    expect(localStorage.getItem(BOOTSTRAP_STORAGE_KEY)).toBe(GENERATED_KEY);
  });
});

describe('createAndPersistBootstrapKey', () => {
  it('generates a fresh key and writes it to localStorage', () => {
    const key = createAndPersistBootstrapKey();

    expect(key).toBe(GENERATED_KEY);
    expect(generatePrivateKey).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(BOOTSTRAP_STORAGE_KEY)).toBe(GENERATED_KEY);
  });
});

describe('loadBootstrapKeyFromStorage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadBootstrapKeyFromStorage()).toBeNull();
  });

  it('returns the stored 0x-prefixed 64-hex key', () => {
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, PERSISTED_KEY);
    expect(loadBootstrapKeyFromStorage()).toBe(PERSISTED_KEY);
  });

  it('returns null for malformed stored values (non-hex / wrong length)', () => {
    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, '0xzz');
    expect(loadBootstrapKeyFromStorage()).toBeNull();

    localStorage.setItem(BOOTSTRAP_STORAGE_KEY, '0x1234');
    expect(loadBootstrapKeyFromStorage()).toBeNull();
  });
});
