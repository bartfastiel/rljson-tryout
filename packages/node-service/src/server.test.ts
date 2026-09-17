import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Configuration } from './configuration.ts';
import { buildServer } from './server.ts';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(packageDirectory, '..', 'package.json'), 'utf-8'),
) as { version: string };

const testConfiguration: Configuration = Object.freeze({
  nodeName: 'node1',
  httpPort: 0,
  logLevel: 'error',
  gitCommit: 'test-commit',
});

describe('buildServer', () => {
  it('answers /health with status 200 and the documented shape', async () => {
    const server = buildServer(testConfiguration);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({
      status: 'ok',
      name: 'node1',
      version: packageJson.version,
      commit: 'test-commit',
    });

    await server.close();
  });

  it('takes name and commit from the given configuration', async () => {
    const server = buildServer(
      Object.freeze({
        ...testConfiguration,
        nodeName: 'node2',
        gitCommit: 'abc1234',
      }),
    );

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toMatchObject({
      name: 'node2',
      commit: 'abc1234',
    });

    await server.close();
  });
});
