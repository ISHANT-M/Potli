import { defineConfig } from 'vitest/config';

const port = process.env.TEST_DB_PORT || '54329';
const testUrl = `postgres://potli_test:potli_test@localhost:${port}/potli_test`;

// Forced, never defaulted: a DATABASE_URL from the shell or .env must not reach the tests.
// The empty proxy value also stops dotenv from restoring the catcher setting.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_WS_PROXY = '';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
    // Every file shares one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      // Empty on purpose: dotenv never overrides it, so tests use plain TCP to Docker.
      DATABASE_WS_PROXY: '',
    },
  },
});
