import { createServer } from 'node:net';

import { defineConfig } from '@playwright/test';

const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('The port probe did not bind to a TCP port.'));
        } else {
          resolve(address.port);
        }
      });
    });
  });

// Playwright evaluates this file once in the test runner and again in every
// worker process. The runner picks the port and hands it down through the
// environment so that the workers target the server the runner started.
const port = process.env.WEB_APP_TEST_PORT ?? String(await findFreePort());
process.env.WEB_APP_TEST_PORT = port;

const baseURL = `http://127.0.0.1:${port}`;
const isContinuousIntegration = process.env.CI !== undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isContinuousIntegration,
  retries: isContinuousIntegration ? 1 : 0,
  reporter: isContinuousIntegration
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      testIgnore: '**/desktop.spec.ts',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      testIgnore: '**/phone.spec.ts',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'node ../node-service/src/main.ts',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HTTP_PORT: port,
      NODE_NAME: 'node-under-test',
      LOG_LEVEL: 'warn',
      // The end-to-end tests exercise one node; discovery would bind the
      // hub and broadcast ports of the machine running them.
      DISCOVERY: 'disabled',
      // The tests read the counts they assert from the node, so they hold
      // for the small seed CI runs them against as for a bigger one chosen
      // with `SEED_SIZE=medium pnpm --filter @rljson-tryout/web-app test:e2e`.
      SEED_SIZE: process.env.SEED_SIZE ?? 'small',
    },
  },
});
