import { breedersSeed, personsSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';

describe('GET /api/breeders', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = new PetShopStore();
    await store.initialize();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers with an empty list when nothing is seeded', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/breeders',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the four seeded breeders in the documented shape', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/breeders',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const breeders = response.json<Record<string, unknown>[]>();
    expect(breeders).toHaveLength(4);
    for (const entry of breeders) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'farmName',
        'hash',
        'id',
        'person',
        'suppliesSince',
      ]);
      const person = entry.person as Record<string, unknown>;
      expect(Object.keys(person).sort()).toStrictEqual(['city', 'id', 'name']);
    }
  });

  it('joins the person of every breeder against the seed', async () => {
    await store.seedIfEmpty();
    const personByHash = new Map(
      personsSeed.map((person) => [person._hash, person]),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/breeders',
    });

    const breeders =
      response.json<
        { id: string; person: { id: string; name: string; city: string } }[]
      >();
    for (const seedRow of breedersSeed) {
      const expectedPerson = personByHash.get(seedRow.personRef);
      const listed = breeders.find((breeder) => breeder.id === seedRow.id);
      expect(listed?.person.id).toBe(expectedPerson?.id);
      expect(listed?.person.name).toBe(expectedPerson?.name);
      expect(listed?.person.city).toBe(expectedPerson?.city);
    }
  });

  it("lists Grandma Duck's farm first, ordered by id", async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/breeders',
    });

    const breeders = response.json<{ id: string }[]>();
    const ids = breeders.map((breeder) => breeder.id);
    expect(ids).toStrictEqual([...ids].sort());
  });
});
