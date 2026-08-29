import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Shared-package logic tests mirror the frontend-respondents / organiser
  // vitest wiring: pure leaf modules run in the plain Node environment with no
  // jsdom and no DOM surface. Tests import each leaf module by DIRECT RELATIVE
  // SOURCE PATH (never the `@s3ntiment/shared` barrel), because the barrel
  // re-exports node-native / peer deps (Lit, Nillion, d3) that do not load in
  // a plain node env. The type-only barrel imports inside some leaves are
  // elided by the esbuild transform, so nothing pulls the heavy graph in.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep output focused; files log their own paths where useful.
    reporters: ['default'],
  },
});
