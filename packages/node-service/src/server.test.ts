import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IoMem } from '@rljson/io';
import { describe, expect, it, vi } from 'vitest';

import { PetShopStore } from './store/petShopStore.ts';
import { buildTestServer } from './testing/testServer.ts';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(packageDirectory, '..', 'package.json'), 'utf-8'),
) as { version: string };

describe('buildServer', () => {
  it('answers /health with status 200 and the documented shape', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()));

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({
      status: 'ok',
      name: 'node1',
      version: packageJson.version,
      commit: 'test-commit',
      startedAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ) as string,
    });

    await server.close();
  });

  it('allows a browser on another node to read /health', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()));

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://node2.example.test' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('*');

    await server.close();
  });

  it('fixes startedAt when the server is built, not per request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
      const server = buildTestServer(new PetShopStore(new IoMem()));

      vi.setSystemTime(new Date('2026-09-17T10:00:05.000Z'));
      const first = await server.inject({ method: 'GET', url: '/health' });
      vi.setSystemTime(new Date('2026-09-17T11:30:00.000Z'));
      const second = await server.inject({ method: 'GET', url: '/health' });

      expect(first.json()).toMatchObject({
        startedAt: '2026-09-17T10:00:00.000Z',
      });
      expect(second.json()).toMatchObject({
        startedAt: '2026-09-17T10:00:00.000Z',
      });

      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes name and commit from the given configuration', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()), {
      nodeName: 'node2',
      gitCommit: 'abc1234',
    });

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
    const server = buildTestServer(new PetShopStore(new IoMem()));

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('<title>Duckburg Pet Shop</title>');

    await server.close();
  });

  it('answers HEAD / like GET / without a body', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()));

    const response = await server.inject({ method: 'HEAD', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toBe('');

    await server.close();
  });

  it('serves the other files with the default cache headers', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()));

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
    const server = buildTestServer(new PetShopStore(new IoMem()), {
      webAppDirectory: resolve(packageDirectory, '..', '..', 'web-app'),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/public/index.html',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');

    await server.close();
  });

  it('answers unknown paths with the 404 of Fastify', async () => {
    const server = buildTestServer(new PetShopStore(new IoMem()));

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
