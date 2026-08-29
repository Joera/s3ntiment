import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the frontend-respondents vitest wiring verbatim (the Tranche-A
  // precedent): logic tests run in the Node environment with no jsdom — any
  // browser surface is stubbed via test/setup.ts + per-module vi.mock.
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
      // test graph can't accidentally pull React into the Node environment.
      react: new URL('./src/empty-module.ts', import.meta.url).pathname,
      'react-dom': new URL('./src/empty-module.ts', import.meta.url).pathname,
    },
  },
  define: {
    // invitation.factory.ts reads BASEURL from import.meta.env at module scope:
    //   const BASEURL = import.meta.env.VITE_PROD == "true"
    //     ? import.meta.env.VITE_FRONTEND_PROD
    //     : import.meta.env.VITE_FRONTEND_DEV;
    // Under vitest `import.meta.env` otherwise resolves to {} -> BASEURL would be
    // undefined and every generated card URL malformed. Defining VITE_FRONTEND_DEV
    // (and leaving VITE_PROD undefined so the else-branch is taken) gives a
    // deterministic base URL with zero production refactor (R2, exploration §6).
    'import.meta.env.VITE_FRONTEND_DEV': JSON.stringify('https://organiser.local/'),
  },
});
