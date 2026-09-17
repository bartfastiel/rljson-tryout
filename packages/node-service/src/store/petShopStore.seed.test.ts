import type { Rljson } from '@rljson/rljson';
import {
  animalTraitsSeed,
  animalsSeed,
  breedersSeed,
  customersSeed,
  generatedSeedFor,
  invoicesSeed,
  personsSeed,
  seedPlans,
  speciesSeed,
  storyLength,
  traitsSeed,
  type SeedSize,
} from '@rljson-tryout/domain';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { StorageKind } from '../configuration.ts';
import {
  validatableDocument,
  validationErrors,
} from '../testing/storeDocument.ts';
import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import type { PetShopStore, SeedReport } from './petShopStore.ts';

/**
 * `PetShopStore.io` is a TypeScript-private field with no runtime
 * enforcement; this narrow view reaches it to dump the whole store for the
 * rljson validator and to read the change sets the seed wrote.
 */
type StoreInternals = {
  io: {
    dump: () => Promise<Rljson>;
    readRows: (request: {
      table: string;
      where: Record<string, string>;
    }) => Promise<Rljson>;
  };
};

const internals = (store: PetShopStore): StoreInternals =>
  store as unknown as StoreInternals;

const dataDirectories = useTemporaryDataDirectories();

/**
 * Seeding `medium` takes under a second in memory and a few seconds into
 * SQLite on a CI runner, so every test that seeds it gets this budget, and
 * the read-only tests share one medium store per storage kind.
 */
const seedingTimeout = 60_000;

const stores: PetShopStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) {
    await store.close();
  }
});

const openStore = async (storage: StorageKind): Promise<PetShopStore> =>
  testStore({ storage, dataDirectory: dataDirectories.next() });

const seededStore = async (
  storage: StorageKind,
  size: SeedSize,
): Promise<{ store: PetShopStore; report: SeedReport }> => {
  const store = await openStore(storage);
  stores.push(store);
  const report = await store.seedIfEmpty(size);
  return { store, report };
};

const handWrittenCounts = {
  species: speciesSeed.length,
  traits: traitsSeed.length,
  persons: personsSeed.length,
  breeders: breedersSeed.length,
  customers: customersSeed.length,
  animals: animalsSeed.length,
  animalTraits: animalTraitsSeed.length,
  invoices: invoicesSeed.length,
  invoiceItems: invoicesSeed.reduce(
    (count, entry) => count + entry.items.length,
    0,
  ),
  changeSets:
    speciesSeed.length +
    traitsSeed.length +
    personsSeed.length +
    breedersSeed.length +
    customersSeed.length +
    animalsSeed.length +
    invoicesSeed.length,
};

const changeSetIds = async (store: PetShopStore): Promise<string[]> => {
  const rljson = await internals(store).io.readRows({
    table: 'changeSets',
    where: {},
  });
  return (rljson.changeSets._data as { id: string }[]).map((row) => row.id);
};

describe.each(storageKinds)(
  'PetShopStore.seedIfEmpty over the %s store',
  (storage) => {
    let store: PetShopStore;
    let report: SeedReport;

    beforeAll(async () => {
      store = await openStore(storage);
      report = await store.seedIfEmpty('medium');
    }, seedingTimeout);

    afterAll(async () => {
      await store.close();
    });

    it('leaves every table empty for the size none', async () => {
      const { store: empty, report: nothing } = await seededStore(
        storage,
        'none',
      );

      expect(nothing).toMatchObject({ seedSize: 'none', animalsSeeded: 0 });
      expect(Object.values(await empty.tableRowCounts())).toStrictEqual(
        Array.from({ length: 20 }, () => 0),
      );
    });

    it('seeds the hand-written rows plus the generated counts of the medium plan, with a history row and a change set for every generated entity', async () => {
      const plan = seedPlans.medium.generated!;
      const generated = generatedSeedFor('medium')!;

      expect(report).toStrictEqual({
        seedSize: 'medium',
        speciesSeeded: handWrittenCounts.species + plan.species,
        traitsSeeded: handWrittenCounts.traits + plan.traits,
        personsSeeded: handWrittenCounts.persons + generated.persons.length,
        breedersSeeded: handWrittenCounts.breeders + plan.breeders,
        customersSeeded: handWrittenCounts.customers + plan.customers,
        animalsSeeded: handWrittenCounts.animals + plan.animals,
        animalTraitsSeeded:
          handWrittenCounts.animalTraits + generated.animalTraits.length,
        invoicesSeeded: handWrittenCounts.invoices + plan.invoices,
        changeSetsSeeded:
          handWrittenCounts.changeSets +
          plan.species +
          plan.traits +
          generated.persons.length +
          plan.breeders +
          plan.customers +
          plan.animals +
          plan.invoices,
      });
      const counts = await store.tableRowCounts();
      expect(counts).toMatchObject({
        animals: report.animalsSeeded,
        animalsInsertHistory: report.animalsSeeded,
        invoices: report.invoicesSeeded,
        invoicesInsertHistory: report.invoicesSeeded,
        invoiceItems: handWrittenCounts.invoiceItems + plan.invoiceItems,
        invoiceItemsInsertHistory:
          handWrittenCounts.invoiceItems + plan.invoiceItems,
        changeSets: report.changeSetsSeeded,
        changeSetsInsertHistory: report.changeSetsSeeded,
      });
      const ids = await changeSetIds(store);
      expect(ids).toContain(`seed-species-${generated.species[0].id}`);
      expect(ids).toContain(`seed-animals-${generated.animals[0].id}`);
      expect(ids).toContain(
        `issue-invoice-${generated.invoices[0].invoiceNumber}`,
      );
      expect(ids).toContain('issue-invoice-2026-0001');
      expect(ids).toContain('seed-species-duck');
      expect(ids).toContain('seed-animals-donald-the-third');
    });

    it('serves the generated rows through every list with their references resolved', async () => {
      const generated = generatedSeedFor('medium')!;

      const animals = await store.listAnimals({}, { limit: 200, offset: 0 });
      const breeders = await store.listBreeders();
      const customers = await store.listCustomers();
      const invoices = await store.listInvoices();

      expect(animals.total).toBe(
        handWrittenCounts.animals + generated.animals.length,
      );
      for (const animal of animals.items) {
        expect(animal.speciesName).not.toBeNull();
        expect(animal.breederFarmName).not.toBeNull();
      }
      for (const breeder of breeders) {
        expect(breeder.person).not.toBeNull();
      }
      for (const customer of customers) {
        expect(customer.person).not.toBeNull();
      }
      for (const invoice of invoices) {
        expect(invoice.customer?.personName).not.toBeNull();
        expect(invoice.itemCount).toBeGreaterThanOrEqual(1);
        expect(invoice.totalCents).toBeGreaterThan(0);
      }
      expect(invoices).toHaveLength(
        handWrittenCounts.invoices + generated.invoices.length,
      );
    });

    it('makes some breeders customers and leaves some invoices open or cancelled', async () => {
      const breederPersons = new Set(
        (await store.listBreeders()).map((breeder) => breeder.person?.id),
      );
      const customersWhoBreed = (await store.listCustomers()).filter(
        (customer) => breederPersons.has(customer.person?.id),
      );
      const statuses = (await store.listInvoices()).map(
        (invoice) => invoice.status,
      );

      expect(customersWhoBreed.length).toBeGreaterThan(
        seedPlans.medium.generated!.breederCustomers,
      );
      expect(
        statuses.filter((status) => status === 'open').length,
      ).toBeGreaterThan(3);
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('paid');
    });

    it('serves a generated animal with its story naming its breeder, its traits resolved and one version', async () => {
      const generated = generatedSeedFor('medium')!;

      for (const row of generated.animals.slice(0, 5)) {
        const animal = (await store.getAnimal(row.id))!;
        const history = (await store.getAnimalHistory(row.id))!;

        expect(animal.hash).toBe(row._hash);
        expect(animal.breeder).not.toBeNull();
        expect(animal.backgroundStory).toContain(animal.breeder!.farmName);
        expect(animal.backgroundStory.length).toBeGreaterThanOrEqual(
          storyLength.minimum,
        );
        expect(animal.traits.length).toBeGreaterThanOrEqual(1);
        expect(animal.traits.length).toBeLessThanOrEqual(4);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ current: true, previous: [] });
      }
    });

    it('prices every generated invoice item at the animal it sells and names its change set', async () => {
      const generated = generatedSeedFor('medium')!;

      for (const row of generated.invoices.slice(0, 5)) {
        const invoice = (await store.getInvoice(row.id))!;

        expect(invoice.hash).toBe(row._hash);
        expect(invoice.changeSetHash).not.toBeNull();
        for (const item of invoice.items) {
          const animal = (await store.getAnimal(item.animal!.id))!;
          expect(item.unitPriceCents).toBe(animal.priceCents);
        }
      }
    });

    it(
      'gives two stores seeded with the same size the same hashes',
      async () => {
        const second = (await seededStore(storage, 'medium')).store;
        const page = { limit: 200, offset: 0 };

        const firstHashes = (await store.listAnimals({}, page)).items.map(
          (animal) => animal.hash,
        );
        const secondHashes = (await second.listAnimals({}, page)).items.map(
          (animal) => animal.hash,
        );
        const firstInvoices = (await store.listInvoices()).map(
          (invoice) => invoice.hash,
        );
        const secondInvoices = (await second.listInvoices()).map(
          (invoice) => invoice.hash,
        );

        expect(firstHashes).toStrictEqual(secondHashes);
        expect(firstInvoices).toStrictEqual(secondInvoices);
      },
      seedingTimeout,
    );

    it('validates the medium store as one rljson document with every reference and change set item resolved', async () => {
      const errors = await validationErrors(
        validatableDocument(await internals(store).io.dump()),
      );

      expect(errors).toStrictEqual({});
    });

    it('seeds nothing into a store that already holds rows, whatever the size', async () => {
      const { store: small } = await seededStore(storage, 'small');

      const again = await small.seedIfEmpty('medium');

      expect(again).toMatchObject({
        seedSize: 'medium',
        speciesSeeded: 0,
        animalsSeeded: 0,
        invoicesSeeded: 0,
        changeSetsSeeded: 0,
      });
      expect((await small.listAnimals()).total).toBe(handWrittenCounts.animals);
    });

    it(
      'continues the invoice numbers of the current year after the hand-written seed',
      async () => {
        const { store: own } = await seededStore(storage, 'medium');

        const issued = await own.issueInvoice({
          customerId: 'donald-duck',
          items: [{ animalId: 'donald-the-third', quantity: 1 }],
        });

        expect(issued.invoiceNumber).toBe('2026-0007');
      },
      seedingTimeout,
    );
  },
);

/**
 * The large seed takes about 1.4 s over the in-memory store and about
 * 16 s over SQLite on the development machine
 * (`docs/findings/seed-generator.md`); the medium tests above prove the
 * generator over both stores, so the large one runs in memory only and
 * keeps the unit suite short.
 */
describe('PetShopStore.seedIfEmpty with the large size over the memory store', () => {
  it('seeds the large plan within the time budget and validates as one document', async () => {
    const plan = seedPlans.large.generated!;
    const started = performance.now();

    const { store, report } = await seededStore('memory', 'large');
    const seedingMilliseconds = performance.now() - started;

    expect(seedingMilliseconds).toBeLessThan(30_000);
    expect(report).toMatchObject({
      seedSize: 'large',
      speciesSeeded: handWrittenCounts.species + plan.species,
      animalsSeeded: handWrittenCounts.animals + plan.animals,
      invoicesSeeded: handWrittenCounts.invoices + plan.invoices,
    });
    expect((await store.tableRowCounts()).invoiceItems).toBe(
      handWrittenCounts.invoiceItems + plan.invoiceItems,
    );
    const page = await store.listAnimals({ query: 'the ' });
    expect(page.items).toHaveLength(page.limit);
    expect(page.total).toBeGreaterThan(page.limit);

    const errors = await validationErrors(
      validatableDocument(await internals(store).io.dump()),
    );
    expect(errors).toStrictEqual({});
  }, 60_000);
});
