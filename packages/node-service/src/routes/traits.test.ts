import { resolve } from 'node:path';

import { traitsSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Configuration } from '../configuration.ts';
import { buildServer } from '../server.ts';
import { PetShopStore } from '../store/petShopStore.ts';

const testConfiguration: Configuration = Object.freeze({
  nodeName: 'node1',
  httpPort: 0,
  logLevel: 'error',
  gitCommit: 'test-commit',
  webAppDirectory: resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'web-app',
    'public',
  ),
});

describe('GET /api/traits', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = new PetShopStore();
    await store.initialize();
    server = buildServer(testConfiguration, store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers with an empty list when nothing is seeded', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/traits',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the nine seeded traits in the documented shape', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/traits',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const traits = response.json<Record<string, string>[]>();
    expect(traits).toHaveLength(9);
    for (const entry of traits) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'description',
        'hash',
        'id',
        'name',
      ]);
    }
  });

  it('returns the row hash of every trait as hash', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/traits',
    });

    const traits = response.json<{ id: string; hash: string }[]>();
    const expected = [...traitsSeed]
      .map((row) => ({ id: row.id, hash: row._hash }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(traits.map(({ id, hash }) => ({ id, hash }))).toStrictEqual(
      expected,
    );
  });
});
