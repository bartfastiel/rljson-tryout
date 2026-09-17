import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Configuration } from './configuration.ts';
import { buildServer } from './server.ts';
import { PetShopStore } from './store/petShopStore.ts';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(packageDirectory, '..', 'package.json'), 'utf-8'),
) as { version: string };

const testConfiguration: Configuration = Object.freeze({
  nodeName: 'node1',
  httpPort: 0,
  logLevel: 'error',
  gitCommit: 'test-commit',
  webAppDirectory: resolve(packageDirectory, '..', '..', 'web-app', 'public'),
});

describe('buildServer', () => {
  it('answers /health with status 200 and the documented shape', async () => {
    const server = buildServer(testConfiguration, new PetShopStore());

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
      new PetShopStore(),
    );

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toMatchObject({
      name: 'node2',
      commit: 'abc1234',
    });

    await server.close();
  });
});

describe('web app', () => {
  it('serves index.html at / with revalidation on every load', async () => {
    const server = buildServer(testConfiguration, new PetShopStore());

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('<title>Duckburg Pet Shop</title>');

    await server.close();
  });

  it('answers HEAD / like GET / without a body', async () => {
    const server = buildServer(testConfiguration, new PetShopStore());

    const response = await server.inject({ method: 'HEAD', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toBe('');

    await server.close();
  });

  it('serves the other files with the default cache headers', async () => {
    const server = buildServer(testConfiguration, new PetShopStore());

    const stylesheet = await server.inject({
      method: 'GET',
      url: '/styles.css',
    });
    const script = await server.inject({ method: 'GET', url: '/app.js' });

    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers['content-type']).toMatch(/^text\/css/);
    expect(stylesheet.headers['cache-control']).toBe('public, max-age=0');
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toMatch(/javascript/);

    await server.close();
  });

  it('serves the directory the configuration names', async () => {
    const server = buildServer(
      Object.freeze({
        ...testConfiguration,
        webAppDirectory: resolve(packageDirectory, '..', '..', 'web-app'),
      }),
      new PetShopStore(),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/public/index.html',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');

    await server.close();
  });

  it('answers unknown paths with the 404 of Fastify', async () => {
    const server = buildServer(testConfiguration, new PetShopStore());

    const page = await server.inject({ method: 'GET', url: '/does-not-exist' });
    const api = await server.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });

    for (const response of [page, api]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
      });
    }

    await server.close();
  });
});
