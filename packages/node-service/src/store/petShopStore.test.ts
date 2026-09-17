import { Route } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  hashed,
  speciesSeed,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from './petShopStore.ts';

/**
 * `PetShopStore.db` is a TypeScript-private field with no runtime
 * enforcement; this narrow view reaches it to write a row `listAnimals`
 * should never see from the seed, so the test can prove the method
 * tolerates a dangling `speciesRef` instead of only asserting it never
 * happens. Neither `Db.insert` nor `IoMem` check references on write (only
 * `Validate` does, see `docs/findings/db-basics.md`, "Joining a
 * reference"), so this is how a dangling reference actually reaches the
 * store outside of a hand-crafted test.
 */
type StoreInternals = {
  db: { insert: (route: Route, tree: unknown) => Promise<unknown> };
};

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

    it('reports a dangling speciesRef as null fields instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost',
        name: 'Ghost Animal',
        speciesRef: 'no-such-species-hash',
        bornOn: '2020-01-01',
        priceCents: 100,
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      const animals = await store.listAnimals();

      expect(animals).toHaveLength(11);
      expect(animals.find((animal) => animal.id === 'ghost')).toStrictEqual({
        id: 'ghost',
        hash: ghost._hash,
        name: 'Ghost Animal',
        speciesId: null,
        speciesName: null,
        bornOn: '2020-01-01',
        priceCents: 100,
      });
    });
  });

  describe('getAnimal', () => {
    beforeEach(async () => {
      await store.seedIfEmpty();
    });

    it('returns undefined for an unknown id', async () => {
      expect(await store.getAnimal('no-such-animal')).toBeUndefined();
    });

    it('returns the animal with its species joined and its full story', async () => {
      const bySpeciesId = new Map(
        speciesSeed.map((species) => [species._hash, species]),
      );

      for (const seedRow of animalsSeed) {
        const expectedSpecies = bySpeciesId.get(seedRow.speciesRef);
        expect(expectedSpecies).toBeDefined();

        expect(await store.getAnimal(seedRow.id)).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          name: seedRow.name,
          speciesId: expectedSpecies!.id,
          speciesName: expectedSpecies!.name,
          bornOn: seedRow.bornOn,
          priceCents: seedRow.priceCents,
          backgroundStory: seedRow.backgroundStory,
        });
      }
    });

    it('round-trips the long seeded story unchanged, character for character', async () => {
      const longSeedRow = animalsSeed.find(
        (row) => row.backgroundStory.length >= 4000,
      );
      expect(longSeedRow).toBeDefined();
      expect(longSeedRow!.backgroundStory.length).toBeGreaterThanOrEqual(4000);

      const stored = await store.getAnimal(longSeedRow!.id);

      expect(stored?.backgroundStory).toBe(longSeedRow!.backgroundStory);
      expect(stored?.backgroundStory.length).toBe(
        longSeedRow!.backgroundStory.length,
      );
    });

    it('reports a dangling speciesRef as null fields instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost',
        name: 'Ghost Animal',
        speciesRef: 'no-such-species-hash',
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost.',
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      expect(await store.getAnimal('ghost')).toStrictEqual({
        id: 'ghost',
        hash: ghost._hash,
        name: 'Ghost Animal',
        speciesId: null,
        speciesName: null,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost.',
      });
    });
  });
});
