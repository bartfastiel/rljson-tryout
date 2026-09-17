import { resolve } from 'node:path';

import { animalsSeed, speciesSeed } from '@rljson-tryout/domain';
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

describe('GET /api/animals', () => {
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
      url: '/api/animals',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the ten seeded animals in the documented shape', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const animals = response.json<Record<string, unknown>[]>();
    expect(animals).toHaveLength(10);
    for (const entry of animals) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'bornOn',
        'hash',
        'id',
        'name',
        'priceCents',
        'speciesId',
        'speciesName',
      ]);
    }
  });

  it('joins the species name of every animal against the seed', async () => {
    await store.seedIfEmpty();
    const speciesById = new Map(
      speciesSeed.map((species) => [species._hash, species]),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals',
    });

    const animals = response.json<{ id: string; speciesName: string }[]>();
    for (const seedRow of animalsSeed) {
      const expectedSpecies = speciesById.get(seedRow.speciesRef);
      const listed = animals.find((animal) => animal.id === seedRow.id);
      expect(listed?.speciesName).toBe(expectedSpecies?.name);
    }
  });

  it('narrows the list with ?species=<id>', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals?species=duck',
    });

    const animals = response.json<{ speciesId: string }[]>();
    expect(animals.length).toBeGreaterThan(0);
    for (const animal of animals) {
      expect(animal.speciesId).toBe('duck');
    }
  });

  it('answers with an empty list for an unknown species id', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals?species=dragon',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });
});
