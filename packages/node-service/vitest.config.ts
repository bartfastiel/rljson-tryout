import { defineConfig } from 'vitest/config';

/**
 * Vitest's own default `include` pattern only matches `*.test.ts` and
 * `*.spec.ts`. The Gherkin step files in `features/steps` use `*.steps.ts`
 * instead, so this package widens the pattern to pick them up too; Sonar
 * already treats everything under `features/` as test code
 * (`sonar-project.properties`). The steps under `features/integration`
 * need Docker and run through `vitest.integration.config.ts` only.
 */
export default defineConfig({
  test: {
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'features/steps/**/*.steps.ts',
    ],
  },
});
