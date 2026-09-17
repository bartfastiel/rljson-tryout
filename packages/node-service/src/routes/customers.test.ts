import { resolve } from 'node:path';

import { customersSeed, personsSeed } from '@rljson-tryout/domain';
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
  traitRelationMode: 'multi-reference',
});

describe('GET /api/customers', () => {
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
      url: '/api/customers',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the five seeded customers in the documented shape, ordered by customer number', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/customers',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const customers = response.json<Record<string, unknown>[]>();
    expect(customers).toHaveLength(5);
    for (const entry of customers) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'customerNumber',
        'hash',
        'id',
        'person',
      ]);
      const person = entry.person as Record<string, unknown>;
      expect(Object.keys(person).sort()).toStrictEqual(['city', 'id', 'name']);
    }
    const numbers = customers.map((entry) => entry.customerNumber);
    expect(numbers).toStrictEqual([...numbers].sort());
  });

  it('joins the person of every customer against the seed', async () => {
    await store.seedIfEmpty();
    const personByHash = new Map(
      personsSeed.map((person) => [person._hash, person]),
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/customers',
    });

    const customers =
      response.json<
        { id: string; person: { id: string; name: string; city: string } }[]
      >();
    for (const seedRow of customersSeed) {
      const expectedPerson = personByHash.get(seedRow.personRef);
      const listed = customers.find((customer) => customer.id === seedRow.id);
      expect(listed?.person.id).toBe(expectedPerson?.id);
      expect(listed?.person.name).toBe(expectedPerson?.name);
      expect(listed?.person.city).toBe(expectedPerson?.city);
    }
  });
});
