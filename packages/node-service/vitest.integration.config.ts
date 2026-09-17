import { defineConfig } from 'vitest/config';

/**
 * The integration features under `features/integration` start the
 * three-node Docker Compose setup of `deploy/compose/three-nodes.yml`, so
 * they need Docker and take a minute; `pnpm test` leaves them out and
 * `pnpm --filter @rljson-tryout/node-service test:integration` runs them
 * with this configuration. One feature at a time, because they share the
 * compose project and its host ports.
 */
export default defineConfig({
  test: {
    include: ['features/integration/**/*.steps.ts'],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
