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

  it('never includes the background story in the list', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals',
    });

    const animals = response.json<Record<string, unknown>[]>();
    for (const entry of animals) {
      expect(entry).not.toHaveProperty('backgroundStory');
    }
  });
});

describe('GET /api/animals/:id', () => {
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

  it('answers 404 for an unknown id', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals/no-such-animal',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: expect.stringContaining('no-such-animal'),
    });
  });

  it('answers with the animal in the documented shape, story included', async () => {
    await store.seedIfEmpty();
    const seedRow = animalsSeed.find((row) => row.id === 'sir-quackington');
    expect(seedRow).toBeDefined();

    const response = await server.inject({
      method: 'GET',
      url: `/api/animals/${seedRow!.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const animal = response.json<Record<string, unknown>>();
    expect(Object.keys(animal).sort()).toStrictEqual([
      'backgroundStory',
      'bornOn',
      'hash',
      'id',
      'name',
      'priceCents',
      'speciesId',
      'speciesName',
    ]);
    expect(animal).toMatchObject({
      id: seedRow!.id,
      hash: seedRow!._hash,
      name: seedRow!.name,
      speciesName: 'Duck',
      backgroundStory: seedRow!.backgroundStory,
    });
  });

  it('answers with a story at least 4000 characters long for the long seeded animal', async () => {
    await store.seedIfEmpty();
    const seedRow = animalsSeed.find(
      (row) => row.backgroundStory.length >= 4000,
    );
    expect(seedRow).toBeDefined();

    const response = await server.inject({
      method: 'GET',
      url: `/api/animals/${seedRow!.id}`,
    });

    const animal = response.json<{ backgroundStory: string }>();
    expect(animal.backgroundStory.length).toBeGreaterThanOrEqual(4000);
  });
});
