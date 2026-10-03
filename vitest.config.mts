import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `globals: false` (the default) means we must `import { describe, it } from
    // 'vitest'` in every test file. We do that explicitly on purpose -- it makes
    // it obvious where the test helpers come from and keeps typecheck working.
    environment: 'node',

    include: ['tests/**/*.test.ts'],

    /**
     * Variables the test process sees. src/config validates these at import time
     * and calls process.exit(1) if they are missing -- so we must provide a
     * syntactically valid DATABASE_URL even though the tests never connect to a
     * real database (they use the in-memory repository).
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/ado_test',
      DATABASE_LOG_QUERIES: 'false',
      PORT: '3001',
    },

    // The request logger would spam every test run.
    silent: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.js'],
      exclude: ['src/db/migrate.ts', 'src/db/seed.ts', 'src/server.ts'],
    },
  },
});