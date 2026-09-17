import { Route } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  breedersSeed,
  breedersTableCfg,
  hashed,
  personsSeed,
  speciesSeed,
  traitsSeed,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from './petShopStore.ts';

/**
 * `PetShopStore.db` is a TypeScript-private field with no runtime
 * enforcement; this narrow view reaches it to write a row `listAnimals`
 * should never see from the seed, so the test can prove the method
 * tolerates a dangling `speciesRef`, a dangling `breederRef` or a dangling
 * `traitsRefs` entry instead of only asserting it never happens. Neither
 * `Db.insert` nor `IoMem` check references on write (only `Validate` does,
 * see `docs/findings/db-basics.md`, "Joining a reference"), so this is how
 * a dangling reference actually reaches the store outside of a
 * hand-crafted test.
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

  it('lists no species, no traits, no breeders, no customers, no animals and no invoices before it is seeded', async () => {
    expect(await store.listSpecies()).toStrictEqual([]);
    expect(await store.listTraits()).toStrictEqual([]);
    expect(await store.listBreeders()).toStrictEqual([]);
    expect(await store.listCustomers()).toStrictEqual([]);
    expect(await store.listAnimals()).toStrictEqual([]);
    expect(await store.listInvoices()).toStrictEqual([]);
  });

  it('seeds the domain species, traits, persons, breeders, customers, animals and invoices into an empty store', async () => {
    const seeded = await store.seedIfEmpty();

    const expectedAnimalTraits = animalsSeed.reduce(
      (sum, animal) => sum + animal.traitsRefs.length,
      0,
    );

    expect(seeded).toStrictEqual({
      speciesSeeded: 3,
      traitsSeeded: 8,
      personsSeeded: 8,
      breedersSeeded: 4,
      customersSeeded: 5,
      animalsSeeded: 10,
      animalTraitsSeeded: expectedAnimalTraits,
      invoicesSeeded: 6,
    });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listTraits()).toHaveLength(8);
    expect(await store.listBreeders()).toHaveLength(4);
    expect(await store.listCustomers()).toHaveLength(5);
    expect(await store.listAnimals()).toHaveLength(10);
    expect(await store.listInvoices()).toHaveLength(6);
  });

  it('seeds only once: a second call inserts nothing', async () => {
    await store.seedIfEmpty();

    const seeded = await store.seedIfEmpty();

    expect(seeded).toStrictEqual({
      speciesSeeded: 0,
      traitsSeeded: 0,
      personsSeeded: 0,
      breedersSeeded: 0,
      customersSeeded: 0,
      animalsSeeded: 0,
      animalTraitsSeeded: 0,
      invoicesSeeded: 0,
    });
    expect(await store.listSpecies()).toHaveLength(3);
    expect(await store.listTraits()).toHaveLength(8);
    expect(await store.listBreeders()).toHaveLength(4);
    expect(await store.listCustomers()).toHaveLength(5);
    expect(await store.listAnimals()).toHaveLength(10);
    expect(await store.listInvoices()).toHaveLength(6);
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
    const personsBefore = structuredClone(personsSeed);
    const breedersBefore = structuredClone(breedersSeed);
    const animalsBefore = structuredClone(animalsSeed);

    await store.seedIfEmpty();

    expect(speciesSeed).toStrictEqual(speciesBefore);
    expect(traitsSeed).toStrictEqual(traitsBefore);
    expect(personsSeed).toStrictEqual(personsBefore);
    expect(breedersSeed).toStrictEqual(breedersBefore);
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
      expect(ids).toHaveLength(8);

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

  describe('listBreeders', () => {
    beforeEach(async () => {
      await store.seedIfEmpty();
    });

    it('lists the breeders ordered by id, with their person joined, in the documented shape', async () => {
      const byPersonHash = new Map(
        personsSeed.map((person) => [person._hash, person]),
      );
      const breeders = await store.listBreeders();

      const ids = breeders.map((breeder) => breeder.id);
      expect(ids).toStrictEqual([...ids].sort());
      expect(ids).toHaveLength(4);

      const byId = (id: string) =>
        breeders.find((breeder) => breeder.id === id);
      for (const seedRow of breedersSeed) {
        const expectedPerson = byPersonHash.get(seedRow.personRef);
        expect(expectedPerson).toBeDefined();

        expect(byId(seedRow.id)).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          farmName: seedRow.farmName,
          suppliesSince: seedRow.suppliesSince,
          person: {
            id: expectedPerson!.id,
            name: expectedPerson!.name,
            city: expectedPerson!.city,
          },
        });
      }
    });

    it('reports a dangling personRef as a null person instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost-farm',
        personRef: 'no-such-person-hash',
        farmName: 'Ghost Farm',
        suppliesSince: '2020-01-01',
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(breedersTableCfg.key),
        { [breedersTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      const breeders = await store.listBreeders();

      expect(breeders).toHaveLength(5);
      expect(
        breeders.find((breeder) => breeder.id === 'ghost-farm'),
      ).toStrictEqual({
        id: 'ghost-farm',
        hash: ghost._hash,
        farmName: 'Ghost Farm',
        suppliesSince: '2020-01-01',
        person: null,
      });
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

    it('joins the species and breeder name and id onto every animal against the seed', async () => {
      const bySpeciesId = new Map(
        speciesSeed.map((species) => [species._hash, species]),
      );
      const byBreederId = new Map(
        breedersSeed.map((breeder) => [breeder._hash, breeder]),
      );
      const animals = await store.listAnimals();

      for (const seedRow of animalsSeed) {
        const expectedSpecies = bySpeciesId.get(seedRow.speciesRef);
        expect(expectedSpecies).toBeDefined();
        const expectedBreeder = byBreederId.get(seedRow.breederRef);
        expect(expectedBreeder).toBeDefined();

        const stored = animals.find((animal) => animal.id === seedRow.id);
        expect(stored).toStrictEqual({
          id: seedRow.id,
          hash: seedRow._hash,
          name: seedRow.name,
          speciesId: expectedSpecies!.id,
          speciesName: expectedSpecies!.name,
          breederId: expectedBreeder!.id,
          breederFarmName: expectedBreeder!.farmName,
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

    it('narrows the list to the given breeder id', async () => {
      const breederId = breedersSeed[0]!.id;
      const expectedIds = animalsSeed
        .filter((animal) => animal.breederRef === breedersSeed[0]!._hash)
        .map((animal) => animal.id)
        .sort();
      expect(expectedIds.length).toBeGreaterThan(0);
      expect(expectedIds.length).toBeLessThan(10);

      const filtered = await store.listAnimals({ breederId });

      expect(filtered.map((animal) => animal.id)).toStrictEqual(expectedIds);
      for (const animal of filtered) {
        expect(animal.breederId).toBe(breederId);
      }
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

    it('combines a species, a breeder and a trait filter', async () => {
      const grandmasFarm = breedersSeed[0]!;
      const traitId = 'competitive-streak';
      const expectedIds = animalsSeed
        .filter((animal) => {
          const trait = traitsSeed.find((row) => row.id === traitId);
          return (
            animal.speciesRef === speciesSeed[2]!._hash &&
            animal.breederRef === grandmasFarm._hash &&
            trait !== undefined &&
            animal.traitsRefs.includes(trait._hash)
          );
        })
        .map((animal) => animal.id)
        .sort();
      expect(expectedIds.length).toBeGreaterThan(0);

      const filtered = await store.listAnimals({
        speciesId: speciesSeed[2]!.id,
        breederId: grandmasFarm.id,
        traitId,
      });

      expect(filtered.map((animal) => animal.id)).toStrictEqual(expectedIds);
    });

    it.each([
      ['speciesId', 'dragon'],
      ['breederId', 'no-such-breeder'],
      ['traitId', 'telekinesis'],
    ] as const)(
      'returns an empty list for an unknown %s',
      async (filterKey, value) => {
        expect(await store.listAnimals({ [filterKey]: value })).toStrictEqual(
          [],
        );
      },
    );

    it('reports a dangling speciesRef as null fields instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost',
        name: 'Ghost Animal',
        speciesRef: 'no-such-species-hash',
        breederRef: breedersSeed[0]!._hash,
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
        breederId: breedersSeed[0]!.id,
        breederFarmName: breedersSeed[0]!.farmName,
        bornOn: '2020-01-01',
        priceCents: 100,
      });
    });

    it('reports a dangling breederRef as null fields instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost-breeder',
        name: 'Ghost Breeder Animal',
        speciesRef: speciesSeed[0]!._hash,
        breederRef: 'no-such-breeder-hash',
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost with no breeder.',
        traitsRefs: [],
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      const animals = await store.listAnimals();

      expect(
        animals.find((animal) => animal.id === 'ghost-breeder'),
      ).toStrictEqual({
        id: 'ghost-breeder',
        hash: ghost._hash,
        name: 'Ghost Breeder Animal',
        speciesId: speciesSeed[0]!.id,
        speciesName: speciesSeed[0]!.name,
        breederId: null,
        breederFarmName: null,
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

    it('returns the animal with its species and breeder joined, its traits resolved and its full story', async () => {
      const bySpeciesId = new Map(
        speciesSeed.map((species) => [species._hash, species]),
      );
      const byBreederHash = new Map(
        breedersSeed.map((breeder) => [breeder._hash, breeder]),
      );
      const byPersonHash = new Map(
        personsSeed.map((person) => [person._hash, person]),
      );
      const byTraitHash = new Map(
        traitsSeed.map((trait) => [trait._hash, trait]),
      );

      for (const seedRow of animalsSeed) {
        const expectedSpecies = bySpeciesId.get(seedRow.speciesRef);
        expect(expectedSpecies).toBeDefined();
        const expectedBreeder = byBreederHash.get(seedRow.breederRef);
        expect(expectedBreeder).toBeDefined();
        const expectedPerson = byPersonHash.get(expectedBreeder!.personRef);
        expect(expectedPerson).toBeDefined();
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
          breederId: expectedBreeder!.id,
          breederFarmName: expectedBreeder!.farmName,
          bornOn: seedRow.bornOn,
          priceCents: seedRow.priceCents,
          backgroundStory: seedRow.backgroundStory,
          traits: expectedTraits,
          breeder: {
            id: expectedBreeder!.id,
            farmName: expectedBreeder!.farmName,
            personName: expectedPerson!.name,
            city: expectedPerson!.city,
          },
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
        breederRef: breedersSeed[0]!._hash,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost.',
        traitsRefs: [],
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );
      const expectedBreeder = breedersSeed[0]!;
      const expectedPerson = personsSeed.find(
        (person) => person._hash === expectedBreeder.personRef,
      );
      expect(expectedPerson).toBeDefined();

      expect(await store.getAnimal('ghost')).toStrictEqual({
        id: 'ghost',
        hash: ghost._hash,
        name: 'Ghost Animal',
        speciesId: null,
        speciesName: null,
        breederId: expectedBreeder.id,
        breederFarmName: expectedBreeder.farmName,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost.',
        traits: [],
        breeder: {
          id: expectedBreeder.id,
          farmName: expectedBreeder.farmName,
          personName: expectedPerson!.name,
          city: expectedPerson!.city,
        },
      });
    });

    it('reports a dangling breederRef as null fields and a null breeder instead of failing', async () => {
      const ghost = hashed({
        id: 'ghost-breeder',
        name: 'Ghost Breeder Animal',
        speciesRef: speciesSeed[0]!._hash,
        breederRef: 'no-such-breeder-hash',
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost with no breeder.',
        traitsRefs: [],
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
      );

      expect(await store.getAnimal('ghost-breeder')).toStrictEqual({
        id: 'ghost-breeder',
        hash: ghost._hash,
        name: 'Ghost Breeder Animal',
        speciesId: speciesSeed[0]!.id,
        speciesName: speciesSeed[0]!.name,
        breederId: null,
        breederFarmName: null,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story for a ghost with no breeder.',
        traits: [],
        breeder: null,
      });
    });

    it('reports a breeder whose own personRef is dangling as a breeder with null personName and city', async () => {
      const ghostBreeder = hashed({
        id: 'ghost-farm',
        personRef: 'no-such-person-hash',
        farmName: 'Ghost Farm',
        suppliesSince: '2020-01-01',
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(breedersTableCfg.key),
        {
          [breedersTableCfg.key]: {
            _type: 'components',
            _data: [ghostBreeder],
          },
        },
      );
      const ghostAnimal = hashed({
        id: 'ghost-animal-with-ghost-breeder',
        name: 'Ghost Animal With Ghost Breeder',
        speciesRef: speciesSeed[0]!._hash,
        breederRef: ghostBreeder._hash,
        bornOn: '2020-01-01',
        priceCents: 100,
        backgroundStory: 'A short story.',
        traitsRefs: [],
      });
      await (store as unknown as StoreInternals).db.insert(
        Route.fromFlat(animalsTableCfg.key),
        {
          [animalsTableCfg.key]: {
            _type: 'components',
            _data: [ghostAnimal],
          },
        },
      );

      const stored = await store.getAnimal('ghost-animal-with-ghost-breeder');

      expect(stored?.breeder).toStrictEqual({
        id: 'ghost-farm',
        farmName: 'Ghost Farm',
        personName: null,
        city: null,
      });
    });

    it('leaves a dangling traitsRefs entry out of traits instead of failing', async () => {
      const knownTraitRef = traitsSeed[0]!._hash;
      const ghost = hashed({
        id: 'ghost-with-traits',
        name: 'Ghost Animal With Traits',
        speciesRef: speciesSeed[0]!._hash,
        breederRef: breedersSeed[0]!._hash,
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

/**
 * Slice B6's acceptance criterion: the `multi-reference` mode (reading
 * `animals.traitsRefs`, slice B5's default) and the `junction` mode (reading
 * `animalTraits`) must answer every trait query identically. Two stores are
 * seeded independently, one per mode; the seed is deterministic
 * (`docs/findings/db-basics.md` and `packages/domain/src/seed/*`), so both
 * hold the same content and any difference in the results comes from the
 * `TraitRelation` implementation, not from the data.
 */
describe('trait relation modes agree', () => {
  it('list the same animals for every seeded trait', async () => {
    const multiReferenceStore = new PetShopStore({
      traitRelationMode: 'multi-reference',
    });
    const junctionStore = new PetShopStore({ traitRelationMode: 'junction' });
    await multiReferenceStore.initialize();
    await junctionStore.initialize();
    await multiReferenceStore.seedIfEmpty();
    await junctionStore.seedIfEmpty();

    try {
      expect(traitsSeed.length).toBeGreaterThan(0);

      for (const trait of traitsSeed) {
        const multiReferenceAnimals = (
          await multiReferenceStore.listAnimals({ traitId: trait.id })
        )
          .map((animal) => animal.id)
          .sort();
        const junctionAnimals = (
          await junctionStore.listAnimals({ traitId: trait.id })
        )
          .map((animal) => animal.id)
          .sort();

        expect(junctionAnimals).toStrictEqual(multiReferenceAnimals);
      }

      const multiReferenceUnknown = await multiReferenceStore.listAnimals({
        traitId: 'telekinesis',
      });
      const junctionUnknown = await junctionStore.listAnimals({
        traitId: 'telekinesis',
      });
      expect(junctionUnknown).toStrictEqual(multiReferenceUnknown);
    } finally {
      await multiReferenceStore.close();
      await junctionStore.close();
    }
  });

  it('resolve the same traits for every seeded animal', async () => {
    const multiReferenceStore = new PetShopStore({
      traitRelationMode: 'multi-reference',
    });
    const junctionStore = new PetShopStore({ traitRelationMode: 'junction' });
    await multiReferenceStore.initialize();
    await junctionStore.initialize();
    await multiReferenceStore.seedIfEmpty();
    await junctionStore.seedIfEmpty();

    try {
      expect(animalsSeed.length).toBeGreaterThan(0);

      for (const animal of animalsSeed) {
        const multiReferenceDetail = await multiReferenceStore.getAnimal(
          animal.id,
        );
        const junctionDetail = await junctionStore.getAnimal(animal.id);

        expect(multiReferenceDetail).toBeDefined();
        expect(
          [...junctionDetail!.traits].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
        ).toStrictEqual(
          [...multiReferenceDetail!.traits].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
        );
      }
    } finally {
      await multiReferenceStore.close();
      await junctionStore.close();
    }
  });
});
