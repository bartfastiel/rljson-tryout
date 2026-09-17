import { animalsSeed, breedersSeed, speciesSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';

describe('GET /api/animals', () => {
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
        'breederFarmName',
        'breederId',
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

  it('narrows the list with ?breeder=<id>', async () => {
    await store.seedIfEmpty();
    const breederId = breedersSeed[0]!.id;

    const response = await server.inject({
      method: 'GET',
      url: `/api/animals?breeder=${breederId}`,
    });

    const animals = response.json<{ breederId: string }[]>();
    expect(animals.length).toBeGreaterThan(0);
    for (const animal of animals) {
      expect(animal.breederId).toBe(breederId);
    }
  });

  it('joins the breeder farm name of every animal against the seed', async () => {
    await store.seedIfEmpty();
    const breederByHash = new Map(
      breedersSeed.map((breeder) => [breeder._hash, breeder]),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals',
    });

    const animals = response.json<{ id: string; breederFarmName: string }[]>();
    for (const seedRow of animalsSeed) {
      const expectedBreeder = breederByHash.get(seedRow.breederRef);
      const listed = animals.find((animal) => animal.id === seedRow.id);
      expect(listed?.breederFarmName).toBe(expectedBreeder?.farmName);
    }
  });

  it('narrows the list with ?trait=<id>', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals?trait=competitive-streak',
    });

    const animals = response.json<{ id: string }[]>();
    expect(animals.length).toBeGreaterThan(0);
    expect(animals.length).toBeLessThan(10);
  });

  it('combines ?species=<id> and ?trait=<id>', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals?species=chicken&trait=competitive-streak',
    });

    const animals = response.json<{ id: string; speciesId: string }[]>();
    expect(animals).toStrictEqual([
      expect.objectContaining({
        id: 'henrietta-the-egg-champion',
        speciesId: 'chicken',
      }),
    ]);
  });

  it.each([
    ['species', 'dragon'],
    ['breeder', 'no-such-breeder'],
    ['trait', 'telekinesis'],
  ])(
    'answers with an empty list for an unknown %s id',
    async (queryParam, value) => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'GET',
        url: `/api/animals?${queryParam}=${value}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toStrictEqual([]);
    },
  );

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
    store = await memoryStore();
    server = buildTestServer(store);
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
      'breeder',
      'breederFarmName',
      'breederId',
      'hash',
      'id',
      'name',
      'priceCents',
      'speciesId',
      'speciesName',
      'traits',
    ]);
    expect(animal).toMatchObject({
      id: seedRow!.id,
      hash: seedRow!._hash,
      name: seedRow!.name,
      speciesName: 'Duck',
      backgroundStory: seedRow!.backgroundStory,
    });
    expect(animal.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fiercely-loyal' }),
      ]),
    );
    expect(animal.breeder).toMatchObject({
      id: (animal as { breederId: string }).breederId,
      farmName: (animal as { breederFarmName: string }).breederFarmName,
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

describe('GET /api/animals/:id?version=<hash>', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    await store.seedIfEmpty();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers with the old version after an edit, in the same shape as the current one', async () => {
    const seedRow = animalsSeed.find((row) => row.id === 'donald-the-third')!;
    await store.updateAnimal('donald-the-third', { priceCents: 61000 });

    const response = await server.inject({
      method: 'GET',
      url: `/api/animals/donald-the-third?version=${seedRow._hash}`,
    });

    expect(response.statusCode).toBe(200);
    const animal = response.json<{ hash: string; priceCents: number }>();
    expect(animal.hash).toBe(seedRow._hash);
    expect(animal.priceCents).toBe(seedRow.priceCents);
    const current = await server.inject({
      method: 'GET',
      url: '/api/animals/donald-the-third',
    });
    expect(Object.keys(animal).sort()).toStrictEqual(
      Object.keys(current.json<Record<string, unknown>>()).sort(),
    );
    expect(current.json<{ priceCents: number }>().priceCents).toBe(61000);
  });

  it('answers 404 for a hash that is not a version of this animal', async () => {
    const other = animalsSeed.find((row) => row.id === 'daphne-duck')!;

    const response = await server.inject({
      method: 'GET',
      url: `/api/animals/donald-the-third?version=${other._hash}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: `No version "${other._hash}" of the animal with id "donald-the-third".`,
    });
  });
});

describe('GET /api/animals/:id/history', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    await store.seedIfEmpty();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers 404 for an unknown id', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/animals/no-such-animal/history',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No animal with id "no-such-animal".',
    });
  });

  it('lists the versions newest first in the documented shape, without the story', async () => {
    const seedRow = animalsSeed.find((row) => row.id === 'donald-the-third')!;
    await store.updateAnimal('donald-the-third', { priceCents: 61000 });

    const response = await server.inject({
      method: 'GET',
      url: '/api/animals/donald-the-third/history',
    });

    expect(response.statusCode).toBe(200);
    const history = response.json<Record<string, unknown>[]>();
    expect(history).toHaveLength(2);
    for (const version of history) {
      expect(Object.keys(version).sort()).toStrictEqual([
        'bornOn',
        'breederId',
        'current',
        'hash',
        'name',
        'previous',
        'priceCents',
        'speciesId',
        'storyLength',
        'timeId',
        'traitIds',
      ]);
    }
    expect(history[0]).toMatchObject({ current: true, priceCents: 61000 });
    expect(history[1]).toMatchObject({
      current: false,
      hash: seedRow._hash,
      priceCents: seedRow.priceCents,
      storyLength: seedRow.backgroundStory.length,
      speciesId: 'duck',
    });
  });
});

describe('PUT /api/animals/:id', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    await store.seedIfEmpty();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  const update = (id: string, body: Record<string, unknown>) =>
    server.inject({ method: 'PUT', url: `/api/animals/${id}`, payload: body });

  it('answers 200 with the new version as the detail endpoint serves it', async () => {
    const response = await update('donald-the-third', { priceCents: 61000 });

    expect(response.statusCode).toBe(200);
    const updated = response.json<{ hash: string; priceCents: number }>();
    expect(updated.priceCents).toBe(61000);
    const detail = await server.inject({
      method: 'GET',
      url: '/api/animals/donald-the-third',
    });
    expect(detail.json()).toStrictEqual(updated);
    const list = await server.inject({ method: 'GET', url: '/api/animals' });
    const listed = list
      .json<{ id: string; hash: string; priceCents: number }[]>()
      .find((animal) => animal.id === 'donald-the-third');
    expect(listed).toMatchObject({ hash: updated.hash, priceCents: 61000 });
  });

  it('answers 404 for an unknown id', async () => {
    const response = await update('no-such-animal', { priceCents: 1 });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No animal with id "no-such-animal".',
    });
  });

  it.each([
    ['an empty body', {}, 'The request names no editable field.'],
    [
      'a negative price',
      { priceCents: -1 },
      'The price must be a whole number of cents, at least 0.',
    ],
    [
      'an unknown species',
      { speciesId: 'dragon' },
      'No species with id "dragon".',
    ],
  ])(
    'answers 400 with the message for %s',
    async (_description, body, message) => {
      const response = await update('donald-the-third', body);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toStrictEqual({
        statusCode: 400,
        error: 'Bad Request',
        message,
      });
    },
  );

  it.each([
    ['a word as the price', { priceCents: 'expensive' }, 'priceCents'],
    ['a numeric string as the price', { priceCents: '100' }, 'priceCents'],
    ['null as the price', { priceCents: null }, 'priceCents'],
    ['a boolean as the price', { priceCents: true }, 'priceCents'],
    ['null as the story', { backgroundStory: null }, 'backgroundStory'],
    ['a number as the name', { name: 123 }, 'name'],
    ['a string as the trait list', { traitIds: 'fiercely-loyal' }, 'traitIds'],
  ])(
    'answers 400 for %s without coercing it and writes nothing',
    async (_description, body, field) => {
      const before = await server.inject({
        method: 'GET',
        url: '/api/animals/donald-the-third',
      });

      const response = await update('donald-the-third', body);

      expect(response.statusCode).toBe(400);
      expect(response.json<{ message: string }>().message).toContain(field);
      const history = await server.inject({
        method: 'GET',
        url: '/api/animals/donald-the-third/history',
      });
      expect(history.json()).toHaveLength(1);
      const after = await server.inject({
        method: 'GET',
        url: '/api/animals/donald-the-third',
      });
      expect(after.json()).toStrictEqual(before.json());
    },
  );
});
