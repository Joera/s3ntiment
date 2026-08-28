import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit/logic tests run in the Node environment. We never pull jsdom — the
  // browser/network surface (Lit, NilDB, IPFS, Base RPC) is stubbed via
  // constructor-injected fakes, vi.mock of the unbuilt @s3ntiment/shared
  // package, and a mocked global fetch instead of real integration.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    reporters: ['default'],
  },
});
