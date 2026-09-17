import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';
import { buildStatsReport } from './stats.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const seededStore = async (): Promise<PetShopStore> => {
  const store = await memoryStore();
  await store.seedIfEmpty();
  cleanups.push(() => store.close());
  return store;
};

const closing = (server: FastifyInstance): FastifyInstance => {
  cleanups.push(() => server.close());
  return server;
};

describe('GET /api/stats', () => {
  it('answers with the documented shape, cross-origin readable', async () => {
    const server = closing(
      buildTestServer(await seededStore(), { seedSize: 'small' }),
    );

    const response = await server.inject({ method: 'GET', url: '/api/stats' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    const stats = response.json<Record<string, unknown>>();
    expect(Object.keys(stats)).toStrictEqual([
      'nodeName',
      'seedSize',
      'uptimeSeconds',
      'startedAt',
      'rssBytes',
      'tables',
    ]);
    expect(stats).toMatchObject({
      nodeName: 'node1',
      seedSize: 'small',
      tables: expect.objectContaining({
        species: 3,
        animals: 10,
        invoices: 6,
        changeSets: 6,
      }) as Record<string, number>,
    });
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(stats.rssBytes).toBeGreaterThan(0);
    expect(Date.parse(stats.startedAt as string)).not.toBeNaN();
  });

  it('reports the configured seed size', async () => {
    const server = closing(
      buildTestServer(await seededStore(), { seedSize: 'medium' }),
    );

    const response = await server.inject({ method: 'GET', url: '/api/stats' });

    expect(response.json<{ seedSize: string }>().seedSize).toBe('medium');
  });
});

describe('buildStatsReport', () => {
  it('derives the uptime from the start and the current time, never negative', async () => {
    const store = { tableRowCounts: async () => ({ species: 3 }) };
    const startedAt = new Date('2026-09-17T10:00:00.000Z');

    const later = await buildStatsReport({
      configuration: { nodeName: 'node2', seedSize: 'large' },
      store,
      startedAt,
      now: () => new Date('2026-09-17T10:02:30.400Z'),
      residentSetSize: () => 123456789,
    });
    const earlier = await buildStatsReport({
      configuration: { nodeName: 'node2', seedSize: 'large' },
      store,
      startedAt,
      now: () => new Date('2026-09-17T09:59:59.000Z'),
      residentSetSize: () => 1,
    });

    expect(later).toStrictEqual({
      nodeName: 'node2',
      seedSize: 'large',
      uptimeSeconds: 150,
      startedAt: '2026-09-17T10:00:00.000Z',
      rssBytes: 123456789,
      tables: { species: 3 },
    });
    expect(earlier.uptimeSeconds).toBe(0);
  });
});
