import { defineConfig } from 'vitest/config';

// Same reason as vitest.config.mts: run outside UTC on purpose.
process.env.TZ = 'Europe/Paris';

// Integration tests run against the Postgres of docker-compose.yml, in a
// dedicated matching_test database that the tests create and empty themselves.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
