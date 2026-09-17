import { Route } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  hashed,
  speciesSeed,
  traitsSeed,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from './petShopStore.ts';

/**
 * `PetShopStore.db` is a TypeScript-private field with no runtime
 * enforcement; this narrow view reaches it to write a row `listAnimals`
 * should never see from the seed, so the test can prove the method
 * tolerates a dangling `speciesRef` or a dangling `traitsRefs` entry instead
 * of only asserting it never happens. Neither `Db.insert` nor `IoMem` check
 * references on write (only `Validate` does, see
 * `docs/findings/db-basics.md`, "Joining a reference"), so this is how a
 * dangling reference actually reaches the store outside of a hand-crafted
 * test.
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

  it('lists no species, no traits and no animals before it is seeded', async () => {
    expect(await store.listSpecies()).toStrictEqual([]);
    expect(await store.listTraits()).toStrictEqual([]);
    expect(await store.listAnimals()).toStrictEqual([]);
  });

  it('seeds the domain species, traits and animals into an empty store', async () => {
    const seeded = await store.seedIfEmpty();

    expect(seeded).toStrictEqual({
      speciesSeeded: 3,
      traitsSeeded: 9,
      animalsSeeded: 10,
    });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listTraits()).toHaveLength(9);
    expect(await store.listAnimals()).toHaveLength(10);
  });

  it('seeds only once: a second call inserts nothing', async () => {
    await store.seedIfEmpty();

    const seeded = await store.seedIfEmpty();

    expect(seeded).toStrictEqual({
      speciesSeeded: 0,
      traitsSeeded: 0,
      animalsSeeded: 0,
    });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listTraits()).toHaveLength(9);
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
    const traitsBefore = structuredClone(traitsSeed);
    const animalsBefore = structuredClone(animalsSeed);

    await store.seedIfEmpty();

    expect(speciesSeed).toStrictEqual(speciesBefore);
    expect(traitsSeed).toStrictEqual(traitsBefore);
    expect(animalsSeed).toStrictEqual(animalsBefore);
  });

  describe('listTraits', () => {
    beforeEach(async () => {
      await store.seedIfEmpty();
    });

    it('lists the traits ordered by id, in the documented shape', async () => {
      const traits = await store.listTraits();

      const ids = traits.map((trait) => trait.id);
      expect(ids).toStrictEqual([...ids].sort());
      expect(ids).toHaveLength(9);

      const byId = (id: string) => traits.find((trait) => trait.id === id);
      for (const seedRow of traitsSeed) {
        expect(byId(seedRow.id)).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          name: seedRow.name,
          description: seedRow.description,
        });
      }
    });
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

    it('narrows the list to the animals carrying the given trait id', async () => {
      const traitId = traitsSeed[0]!.id;
      const expectedIds = animalsSeed
        .filter((animal) => animal.traitsRefs.includes(traitsSeed[0]!._hash))
        .map((animal) => animal.id)
        .sort();
      expect(expectedIds.length).toBeGreaterThan(0);
      expect(expectedIds.length).toBeLessThan(10);

      const filtered = await store.listAnimals({ traitId });

      expect(filtered.map((animal) => animal.id)).toStrictEqual(expectedIds);
    });

    it('combines a species and a trait filter', async () => {
      const traitId = 'competitive-streak';
      const expectedIds = animalsSeed
        .filter((animal) => {
          const trait = traitsSeed.find((row) => row.id === traitId);
          return (
            animal.speciesRef === speciesSeed[2]!._hash &&
            trait !== undefined &&
            animal.traitsRefs.includes(trait._hash)
          );
        })
        .map((animal) => animal.id)
        .sort();
      expect(expectedIds.length).toBeGreaterThan(0);

      const filtered = await store.listAnimals({
        speciesId: speciesSeed[2]!.id,
        traitId,
      });

      expect(filtered.map((animal) => animal.id)).toStrictEqual(expectedIds);
      for (const animal of filtered) {
        expect(animal.speciesId).toBe(speciesSeed[2]!.id);
      }
    });

    it('returns an empty list for an unknown trait id', async () => {
      expect(await store.listAnimals({ traitId: 'telekinesis' })).toStrictEqual(
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
        backgroundStory: 'A short story for a ghost.',
        traitsRefs: [],
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

    it('returns the animal with its species joined, its traits resolved and its full story', async () => {
      const bySpeciesId = new Map(
        speciesSeed.map((species) => [species._hash, species]),
      );
      const byTraitHash = new Map(
        traitsSeed.map((trait) => [trait._hash, trait]),
      );

      for (const seedRow of animalsSeed) {
        const expectedSpecies = bySpeciesId.get(seedRow.speciesRef);
        expect(expectedSpecies).toBeDefined();
        const expectedTraits = seedRow.traitsRefs.map((traitRef) => {
          const trait = byTraitHash.get(traitRef);
          expect(trait).toBeDefined();
          return { id: trait!.id, name: trait!.name };
        });

        expect(await store.getAnimal(seedRow.id)).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          name: seedRow.name,
          speciesId: expectedSpecies!.id,
          speciesName: expectedSpecies!.name,
          bornOn: seedRow.bornOn,
          priceCents: seedRow.priceCents,
          backgroundStory: seedRow.backgroundStory,
          traits: expectedTraits,
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
        traitsRefs: [],
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
        traits: [],
      });
    });

    it('leaves a dangling traitsRefs entry out of traits instead of failing', async () => {
      const knownTraitRef = traitsSeed[0]!._hash;
      const ghost = hashed({
        id: 'ghost-with-traits',
        name: 'Ghost Animal With Traits',
        speciesRef: speciesSeed[0]!._hash,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost with a dangling trait.',
        traitsRefs: [knownTraitRef, 'no-such-trait-hash'],
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      const stored = await store.getAnimal('ghost-with-traits');

      expect(stored?.traits).toStrictEqual([
        { id: traitsSeed[0]!.id, name: traitsSeed[0]!.name },
      ]);
    });
  });
});
