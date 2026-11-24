import { configDefaults, defineConfig } from 'vitest/config';

// Run the tests outside UTC on purpose: any date computed in local time
// would then shift by a day and fail, instead of passing only on UTC machines.
process.env.TZ = 'Europe/Paris';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need Postgres: they run with npm run test:integration.
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
  },
});
