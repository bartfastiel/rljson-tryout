import { animalsSeed, speciesSeed } from '@rljson-tryout/domain';
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

  it('lists no species and no animals before it is seeded', async () => {
    expect(await store.listSpecies()).toStrictEqual([]);
    expect(await store.listAnimals()).toStrictEqual([]);
  });

  it('seeds the domain species and animals into an empty store', async () => {
    const seeded = await store.seedIfEmpty();

    expect(seeded).toStrictEqual({ speciesSeeded: 3, animalsSeeded: 10 });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listAnimals()).toHaveLength(10);
  });

  it('seeds only once: a second call inserts nothing', async () => {
    await store.seedIfEmpty();

    const seeded = await store.seedIfEmpty();

    expect(seeded).toStrictEqual({ speciesSeeded: 0, animalsSeeded: 0 });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listAnimals()).toHaveLength(10);
  });

  it('lists the species ordered by id', async () => {
    await store.seedIfEmpty();

    const ids = (await store.listSpecies()).map((row) => row.id);

    expect(ids).toStrictEqual(['chicken', 'dog', 'duck']);
  });

  it('stores species rows whose hashes equal the domain seed hashes', async () => {
    await store.seedIfEmpty();

    const stored = await store.listSpecies();

    const byId = (id: string) => stored.find((row) => row.id === id);
    for (const seedRow of speciesSeed) {
      expect(byId(seedRow.id)).toStrictEqual(seedRow);
    }
  });

  it('leaves the domain seeds untouched while seeding', async () => {
    const speciesBefore = structuredClone(speciesSeed);
    const animalsBefore = structuredClone(animalsSeed);

    await store.seedIfEmpty();

    expect(speciesSeed).toStrictEqual(speciesBefore);
    expect(animalsSeed).toStrictEqual(animalsBefore);
  });

  describe('listAnimals', () => {
    beforeEach(async () => {
      await store.seedIfEmpty();
    });

    it('lists every animal ordered by id', async () => {
      const ids = (await store.listAnimals()).map((row) => row.id);

      expect(ids).toStrictEqual([...ids].sort());
      expect(ids).toHaveLength(10);
    });

    it('joins the species name and id onto every animal against the seed', async () => {
      const bySpeciesId = new Map(
        speciesSeed.map((species) => [species._hash, species]),
      );
      const animals = await store.listAnimals();

      for (const seedRow of animalsSeed) {
        const expectedSpecies = bySpeciesId.get(seedRow.speciesRef);
        expect(expectedSpecies).toBeDefined();

        const stored = animals.find((animal) => animal.id === seedRow.id);
        expect(stored).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          name: seedRow.name,
          speciesId: expectedSpecies!.id,
          speciesName: expectedSpecies!.name,
          bornOn: seedRow.bornOn,
          priceCents: seedRow.priceCents,
        });
      }
    });

    it('narrows the list to the given species id', async () => {
      const ducks = await store.listAnimals({ speciesId: 'duck' });

      expect(ducks.length).toBeGreaterThan(0);
      expect(ducks.length).toBeLessThan(10);
      for (const duck of ducks) {
        expect(duck.speciesId).toBe('duck');
      }
    });

    it('returns an empty list for an unknown species id', async () => {
      expect(await store.listAnimals({ speciesId: 'dragon' })).toStrictEqual(
        [],
      );
    });
  });
});
