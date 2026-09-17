import { speciesSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';

describe('GET /api/species', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers with an empty list when nothing is seeded', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the three seeded species in the documented shape', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const species = response.json<Record<string, string>[]>();
    expect(species).toHaveLength(3);
    for (const entry of species) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'description',
        'hash',
        'id',
        'latinName',
        'name',
      ]);
    }
  });

  it('returns the row hash of every species as hash', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    const species = response.json<{ id: string; hash: string }[]>();
    const expected = [...speciesSeed]
      .map((row) => ({ id: row.id, hash: row._hash }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(species.map(({ id, hash }) => ({ id, hash }))).toStrictEqual(
      expected,
    );
  });
});
