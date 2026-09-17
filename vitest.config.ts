import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The web app is tested end to end with Playwright, not with Vitest.
    projects: ['packages/*', '!packages/web-app'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: ['**/*.test.ts'],
    },
  },
});
