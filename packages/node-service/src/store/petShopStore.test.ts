import { speciesSeed } from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from './petShopStore.ts';

describe('PetShopStore', () => {
  let store: PetShopStore;

  beforeEach(async () => {
    store = new PetShopStore();
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('lists no species before it is seeded', async () => {
    expect(await store.listSpecies()).toStrictEqual([]);
  });

  it('seeds the three domain species into an empty store', async () => {
    const seededRows = await store.seedIfEmpty();

    expect(seededRows).toBe(3);
    expect(await store.listSpecies()).toHaveLength(3);
  });

  it('seeds only once: a second call inserts nothing', async () => {
    await store.seedIfEmpty();

    const seededRows = await store.seedIfEmpty();

    expect(seededRows).toBe(0);
    expect(await store.listSpecies()).toHaveLength(3);
  });

  it('lists the species ordered by id', async () => {
    await store.seedIfEmpty();

    const ids = (await store.listSpecies()).map((row) => row.id);

    expect(ids).toStrictEqual(['chicken', 'dog', 'duck']);
  });

  it('stores rows whose hashes equal the domain seed hashes', async () => {
    await store.seedIfEmpty();

    const stored = await store.listSpecies();

    const byId = (id: string) => stored.find((row) => row.id === id);
    for (const seedRow of speciesSeed) {
      expect(byId(seedRow.id)).toStrictEqual(seedRow);
    }
  });

  it('leaves the domain seed untouched while seeding', async () => {
    const before = structuredClone(speciesSeed);

    await store.seedIfEmpty();

    expect(speciesSeed).toStrictEqual(before);
  });
});
