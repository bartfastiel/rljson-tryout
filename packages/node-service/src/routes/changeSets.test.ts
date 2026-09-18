import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChangeSetPayload, PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';

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

describe('GET /api/change-sets/:hash', () => {
  it('answers the change set of an edit with the rows before and after', async () => {
    const store = await seededStore();
    const server = closing(buildTestServer(store));
    const edit = await server.inject({
      method: 'PUT',
      url: '/api/animals/bowser-the-guard-dog',
      payload: { name: 'Bowser the Retired Guard Dog' },
    });
    expect(edit.statusCode).toBe(200);
    const [latest] = (await store.heldChangeSets()).slice(-1);

    const response = await server.inject({
      method: 'GET',
      url: `/api/change-sets/${latest!.hash}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const payload = response.json<ChangeSetPayload>();
    expect(Object.keys(payload)).toStrictEqual(['hash', 'id', 'items']);
    expect(payload.hash).toBe(latest!.hash);
    expect(payload.id).toMatch(/^update-animal-bowser-the-guard-dog-/);
    const animal = payload.items.find((item) => item.table === 'animals');
    expect(Object.keys(animal!)).toStrictEqual([
      'table',
      'ref',
      'row',
      'previousRow',
    ]);
    expect(animal!.row).toMatchObject({
      name: 'Bowser the Retired Guard Dog',
    });
    expect(animal!.previousRow).toMatchObject({ name: 'Bowser the Guard Dog' });
    const history = payload.items.find(
      (item) => item.table === 'animalsInsertHistory',
    );
    expect(history!.row).toMatchObject({ animalsRef: animal!.ref });
    expect(history!.previousRow).toBeNull();
  });

  it('answers 404 for a change set this node does not hold', async () => {
    const server = closing(buildTestServer(await seededStore()));

    const response = await server.inject({
      method: 'GET',
      url: '/api/change-sets/NoSuchChangeSetHash00',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message:
        'This node holds no change set with hash "NoSuchChangeSetHash00".',
    });
  });
});
