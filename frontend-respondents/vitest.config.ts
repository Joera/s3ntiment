import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Logic tests run in the Node environment. We never pull jsdom — any
  // browser surface needed by the controller/component tests is stubbed via
  // mocks (window/document/router) instead of a DOM library.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Keep test output focused; files already log their own paths.
    reporters: ['default'],
  },
  resolve: {
    alias: {
      // Mirror vite.config.js: neutralize any transitive React imports so the
      // test graph can't accidentally pull React into the node environment.
      react: new URL('./src/empty-module.ts', import.meta.url).pathname,
      'react-dom': new URL('./src/empty-module.ts', import.meta.url).pathname,
    },
  },
});
