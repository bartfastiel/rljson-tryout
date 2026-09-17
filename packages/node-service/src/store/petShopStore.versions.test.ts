import { Route, type InsertHistoryRow, type Rljson } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  breedersSeed,
  hashed,
  speciesSeed,
  traitsSeed,
  type AnimalChanges,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import {
  AnimalValidationError,
  type PetShopStore,
  type AnimalDetail,
} from './petShopStore.ts';
import type { TraitRelationMode } from './traitRelation.ts';

/**
 * `PetShopStore.db` and `.io` are TypeScript-private fields with no runtime
 * enforcement; this narrow view reaches them to write rows the way a peer
 * or a hostile node might (two versions of one animal that both claim the
 * same predecessor), and to read history and change set rows back by table
 * exactly as a peer pulling a change set would.
 */
type StoreInternals = {
  db: { insert: (route: Route, tree: unknown) => Promise<unknown> };
  io: {
    readRows: (request: {
      table: string;
      where: Record<string, string>;
    }) => Promise<Rljson>;
  };
};

const internals = (store: PetShopStore): StoreInternals =>
  store as unknown as StoreInternals;

const seedAnimal = (id: string) => {
  const animal = animalsSeed.find((row) => row.id === id);
  expect(animal).toBeDefined();
  return animal!;
};

const traitHash = (traitId: string): string => {
  const trait = traitsSeed.find((row) => row.id === traitId);
  expect(trait).toBeDefined();
  return trait!._hash;
};

const rowsOf = async (store: PetShopStore, table: string) =>
  (await internals(store).io.readRows({ table, where: {} }))[table]!._data;

const historyOf = async (
  store: PetShopStore,
  table: string,
): Promise<InsertHistoryRow<string>[]> =>
  (await rowsOf(store, `${table}InsertHistory`)) as InsertHistoryRow<string>[];

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describe.each<TraitRelationMode>(['multi-reference', 'junction'])(
    'PetShopStore animal versions in %s mode',
    (traitRelationMode) => {
      let store: PetShopStore;

      beforeEach(async () => {
        store = await testStore(
          { storage, dataDirectory: dataDirectories.next() },
          { traitRelationMode },
        );
        await store.seedIfEmpty();
      });

      afterEach(async () => {
        await store.close();
      });

      describe('getAnimalHistory', () => {
        it('returns undefined for an unknown id', async () => {
          expect(
            await store.getAnimalHistory('no-such-animal'),
          ).toBeUndefined();
        });

        it('lists one current version per seeded animal in the documented shape', async () => {
          const donald = seedAnimal('donald-the-third');

          const history = await store.getAnimalHistory('donald-the-third');

          expect(history).toHaveLength(1);
          expect(history![0]).toStrictEqual({
            hash: donald._hash,
            timeId: expect.stringMatching(/^\d+:.{4}$/) as string,
            previous: [],
            current: true,
            name: donald.name,
            priceCents: donald.priceCents,
            bornOn: donald.bornOn,
            speciesId: 'duck',
            breederId: breedersSeed.find(
              (breeder) => breeder._hash === donald.breederRef,
            )!.id,
            traitIds: expect.arrayContaining(
              donald.traitsRefs.map(
                (traitRef) =>
                  traitsSeed.find((trait) => trait._hash === traitRef)!.id,
              ),
            ) as string[],
            storyLength: donald.backgroundStory.length,
          });
          expect(history![0]!.traitIds).toHaveLength(donald.traitsRefs.length);
        });
      });

      describe('updateAnimal', () => {
        it('returns undefined for an unknown id and writes nothing', async () => {
          const animalsBefore = await rowsOf(store, 'animals');

          expect(
            await store.updateAnimal('no-such-animal', { priceCents: 1 }),
          ).toBeUndefined();

          expect(await rowsOf(store, 'animals')).toHaveLength(
            animalsBefore.length,
          );
        });

        it('writes a new version with the changed price and returns it as getAnimal serves it', async () => {
          const before = (await store.getAnimal('donald-the-third'))!;

          const updated = await store.updateAnimal('donald-the-third', {
            priceCents: 61000,
          });

          expect(updated).toStrictEqual({
            ...before,
            hash: updated!.hash,
            priceCents: 61000,
          });
          expect(updated!.hash).not.toBe(before.hash);
          expect(await store.getAnimal('donald-the-third')).toStrictEqual(
            updated,
          );
        });

        it('makes the list show the new price and keeps one entry per animal', async () => {
          await store.updateAnimal('donald-the-third', { priceCents: 61000 });

          const animals = await store.listAnimals();

          expect(animals).toHaveLength(animalsSeed.length);
          expect(
            animals.find((animal) => animal.id === 'donald-the-third')
              ?.priceCents,
          ).toBe(61000);
        });

        it('lists both versions in the history, newest first, only the new one current', async () => {
          const original = seedAnimal('donald-the-third');
          const updated = (await store.updateAnimal('donald-the-third', {
            priceCents: 61000,
          }))!;

          const history = (await store.getAnimalHistory('donald-the-third'))!;

          expect(history).toHaveLength(2);
          expect(history[0]).toMatchObject({
            hash: updated.hash,
            current: true,
            priceCents: 61000,
            previous: [history[1]!.timeId],
          });
          expect(history[1]).toMatchObject({
            hash: original._hash,
            current: false,
            priceCents: original.priceCents,
            previous: [],
          });
        });

        it('chains a third version onto the second, not onto the first', async () => {
          await store.updateAnimal('donald-the-third', { priceCents: 61000 });
          await store.updateAnimal('donald-the-third', { priceCents: 62000 });

          const history = (await store.getAnimalHistory('donald-the-third'))!;

          expect(history.map((version) => version.priceCents)).toStrictEqual([
            62000, 61000, 52000,
          ]);
          expect(history.map((version) => version.current)).toStrictEqual([
            true,
            false,
            false,
          ]);
          expect(history[0]!.previous).toStrictEqual([history[1]!.timeId]);
          expect(history[1]!.previous).toStrictEqual([history[2]!.timeId]);
        });

        it('keeps the traits when the changes do not name them', async () => {
          const before = (await store.getAnimal('sir-quackington'))!;
          expect(before.traits.length).toBeGreaterThan(1);

          const updated = (await store.updateAnimal('sir-quackington', {
            name: 'Sir Quackington the First',
          }))!;

          expect(updated.name).toBe('Sir Quackington the First');
          expect(updated.traits).toStrictEqual(before.traits);
          const history = (await store.getAnimalHistory('sir-quackington'))!;
          expect(history[0]!.traitIds.sort()).toStrictEqual(
            before.traits.map((trait) => trait.id).sort(),
          );
        });

        it('changes every editable field at once, resolving ids to current hashes', async () => {
          const breeder = breedersSeed[1]!;

          const updated = (await store.updateAnimal('donald-the-third', {
            name: 'Donald the Fourth',
            speciesId: 'chicken',
            breederId: breeder.id,
            bornOn: '2024-02-29',
            priceCents: 100,
            backgroundStory: 'A brand new story.',
            traitIds: ['fiercely-loyal', 'competitive-streak'],
          }))!;

          expect(updated).toMatchObject({
            name: 'Donald the Fourth',
            speciesId: 'chicken',
            speciesName: 'Chicken',
            breederId: breeder.id,
            breederFarmName: breeder.farmName,
            bornOn: '2024-02-29',
            priceCents: 100,
            backgroundStory: 'A brand new story.',
          });
          expect(updated.traits.map((trait) => trait.id).sort()).toStrictEqual([
            'competitive-streak',
            'fiercely-loyal',
          ]);
          const stored = (await rowsOf(store, 'animals')).find(
            (row) => row._hash === updated.hash,
          ) as { speciesRef: string; breederRef: string; traitsRefs: string[] };
          expect(stored.speciesRef).toBe(
            speciesSeed.find((species) => species.id === 'chicken')!._hash,
          );
          expect(stored.breederRef).toBe(breeder._hash);
          expect(stored.traitsRefs).toStrictEqual([
            traitHash('competitive-streak'),
            traitHash('fiercely-loyal'),
          ]);
        });

        it('writes traitsRefs in the canonical order whatever order the ids come in', async () => {
          const first = (await store.updateAnimal('donald-the-third', {
            traitIds: ['keen-senses', 'fiercely-loyal'],
          }))!;
          const second = (await store.updateAnimal('donald-the-third', {
            traitIds: ['fiercely-loyal', 'keen-senses'],
          }))!;

          expect(second.hash).toBe(first.hash);
          expect(first.traits.map((trait) => trait.id)).toStrictEqual([
            'fiercely-loyal',
            'keen-senses',
          ]);
        });

        it('removes every trait when given an empty trait list', async () => {
          const updated = (await store.updateAnimal('sir-quackington', {
            traitIds: [],
          }))!;

          expect(updated.traits).toStrictEqual([]);
          expect(
            await store.listAnimals({ traitId: 'fiercely-loyal' }),
          ).not.toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: 'sir-quackington' }),
            ]),
          );
        });

        it('trims the name', async () => {
          const updated = await store.updateAnimal('donald-the-third', {
            name: '  Donald  ',
          });

          expect(updated?.name).toBe('Donald');
        });

        it('re-creates the junction rows for the new animal hash as new versions of each pairing', async () => {
          const updated = (await store.updateAnimal('sir-quackington', {
            priceCents: 1,
          }))!;

          const pairings = (await rowsOf(store, 'animalTraits')) as {
            _hash: string;
            id: string;
            animalRef: string;
            traitRef: string;
          }[];
          const forNewVersion = pairings.filter(
            (pairing) => pairing.animalRef === updated.hash,
          );
          expect(
            forNewVersion.map((pairing) => pairing.id).sort(),
          ).toStrictEqual(
            updated.traits
              .map((trait) => `sir-quackington--${trait.id}`)
              .sort(),
          );
          const history = await historyOf(store, 'animalTraits');
          for (const pairing of forNewVersion) {
            const written = history.filter(
              (row) => row.animalTraitsRef === pairing._hash,
            );
            expect(written).toHaveLength(1);
            expect(written[0]!.previous).toHaveLength(1);
            const previous = history.find(
              (row) => row.timeId === written[0]!.previous![0],
            );
            const previousPairing = pairings.find(
              (candidate) => candidate._hash === previous?.animalTraitsRef,
            );
            expect(previousPairing?.id).toBe(pairing.id);
          }
        });

        it('writes one change set naming the animal row, its history row and every junction row with its history row', async () => {
          const updated = (await store.updateAnimal('sir-quackington', {
            priceCents: 1,
          }))!;

          const changeSets = (await rowsOf(store, 'changeSets')) as {
            id: string;
            items: { table: string; ref: string }[];
          }[];
          const changeSet = changeSets.find((candidate) =>
            candidate.id.startsWith('update-animal-sir-quackington-'),
          );
          expect(changeSet).toBeDefined();
          const traitCount = updated.traits.length;
          expect(changeSet!.items.map((item) => item.table)).toStrictEqual([
            'animals',
            'animalsInsertHistory',
            ...Array.from({ length: traitCount }, () => [
              'animalTraits',
              'animalTraitsInsertHistory',
            ]).flat(),
          ]);
          expect(changeSet!.items[0]!.ref).toBe(updated.hash);
          for (const item of changeSet!.items) {
            const rows = (
              await internals(store).io.readRows({
                table: item.table,
                where: { _hash: item.ref },
              })
            )[item.table]!._data;
            expect(rows).toHaveLength(1);
          }
          const [animalHistory] = (await historyOf(store, 'animals')).filter(
            (row) => row.animalsRef === updated.hash,
          );
          expect(changeSet!.id).toBe(
            `update-animal-sir-quackington-${animalHistory!.timeId}`,
          );
        });

        it('serialises concurrent edits of one animal into a chain, never a branch', async () => {
          await Promise.all([
            store.updateAnimal('donald-the-third', { priceCents: 1 }),
            store.updateAnimal('donald-the-third', { priceCents: 2 }),
            store.updateAnimal('donald-the-third', { priceCents: 3 }),
          ]);

          const history = (await store.getAnimalHistory('donald-the-third'))!;

          expect(history).toHaveLength(4);
          expect(history.filter((version) => version.current)).toHaveLength(1);
          expect(history[0]!.priceCents).toBe(3);
        });

        it.each<[string, Record<string, unknown>, string]>([
          ['no field', {}, 'The request names no editable field.'],
          [
            'a field that is not editable',
            { price: 5 },
            '"price" is not an editable field of an animal; editable fields are name, speciesId, breederId, bornOn, priceCents, backgroundStory, traitIds.',
          ],
          ['an empty name', { name: '' }, 'The name must not be empty.'],
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
          [
            'an unknown breeder',
            { breederId: 'no-such-farm' },
            'No breeder with id "no-such-farm".',
          ],
          [
            'an unknown trait',
            { traitIds: ['fiercely-loyal', 'telekinesis'] },
            'No trait with id "telekinesis".',
          ],
        ])(
          'rejects %s and writes nothing',
          async (_description, changes, message) => {
            const animalsBefore = await rowsOf(store, 'animals');
            const changeSetsBefore = await rowsOf(store, 'changeSets');

            await expect(
              store.updateAnimal('donald-the-third', changes as AnimalChanges),
            ).rejects.toThrow(new AnimalValidationError(message));

            expect(await rowsOf(store, 'animals')).toHaveLength(
              animalsBefore.length,
            );
            expect(await rowsOf(store, 'changeSets')).toHaveLength(
              changeSetsBefore.length,
            );
            expect(
              await store.getAnimalHistory('donald-the-third'),
            ).toHaveLength(1);
          },
        );

        it('keeps editing after a rejected edit', async () => {
          await expect(
            store.updateAnimal('donald-the-third', { name: '' }),
          ).rejects.toThrow(AnimalValidationError);

          const updated = await store.updateAnimal('donald-the-third', {
            priceCents: 5,
          });

          expect(updated?.priceCents).toBe(5);
        });
      });

      describe('getAnimal with a version', () => {
        it('serves an old version read-only by its hash', async () => {
          const original = seedAnimal('donald-the-third');
          await store.updateAnimal('donald-the-third', { priceCents: 61000 });

          const old = await store.getAnimal('donald-the-third', {
            version: original._hash,
          });

          expect(old).toMatchObject({
            hash: original._hash,
            priceCents: original.priceCents,
          });
        });

        it('returns undefined for a hash that is not a version of this animal', async () => {
          const daisy = seedAnimal('daphne-duck');

          expect(
            await store.getAnimal('donald-the-third', { version: daisy._hash }),
          ).toBeUndefined();
          expect(
            await store.getAnimal('donald-the-third', {
              version: 'no-such-hash',
            }),
          ).toBeUndefined();
        });
      });

      describe('invoices after an edit', () => {
        it('issues an invoice at the new price and keeps old invoices at the price they were issued at', async () => {
          const invoicesBefore = await store.listInvoices();
          await store.updateAnimal('sir-quackington', { priceCents: 99900 });

          const issued = await store.issueInvoice({
            customerId: 'scrooge-mcduck',
            items: [{ animalId: 'sir-quackington', quantity: 1 }],
          });

          expect(issued.items[0]!.unitPriceCents).toBe(99900);
          expect(issued.items[0]!.animal?.name).toBe('Sir Quackington');
          const invoicesAfter = await store.listInvoices();
          for (const invoice of invoicesBefore) {
            expect(
              invoicesAfter.find((candidate) => candidate.id === invoice.id),
            ).toStrictEqual(invoice);
          }
        });
      });
    },
  );

  describe('PetShopStore edits agree across trait relation modes', () => {
    it('produces the same row hash for the same edit in both modes', async () => {
      const stores = await Promise.all(
        (['multi-reference', 'junction'] as const).map(async (mode) => {
          const store = await testStore(
            { storage, dataDirectory: dataDirectories.next() },
            { traitRelationMode: mode },
          );
          await store.seedIfEmpty();
          return store;
        }),
      );
      try {
        const [renamedInMultiReference, renamedInJunction] = await Promise.all(
          stores.map((store) =>
            store.updateAnimal('sir-quackington', { name: 'Gadget Edited' }),
          ),
        );
        const [restoredInMultiReference, restoredInJunction] =
          await Promise.all(
            stores.map((store) =>
              store.updateAnimal('sir-quackington', {
                name: 'Sir Quackington',
              }),
            ),
          );

        expect(renamedInJunction!.hash).toBe(renamedInMultiReference!.hash);
        expect(restoredInJunction!.hash).toBe(restoredInMultiReference!.hash);
        expect(restoredInMultiReference!.hash).toBe(
          seedAnimal('sir-quackington')._hash,
        );
        expect(renamedInJunction!.traits).toStrictEqual(
          renamedInMultiReference!.traits,
        );
      } finally {
        await Promise.all(stores.map((store) => store.close()));
      }
    });
  });

  describe('PetShopStore lists resolve through the current-version rule', () => {
    let store: PetShopStore;

    beforeEach(async () => {
      store = await testStore({
        storage,
        dataDirectory: dataDirectories.next(),
      });
      await store.seedIfEmpty();
    });

    afterEach(async () => {
      await store.close();
    });

    const insertVersion = async (
      tableKey: string,
      row: { _hash: string },
      previousTimeId?: string,
    ) => {
      const route = Route.fromFlat(
        previousTimeId === undefined
          ? tableKey
          : `${tableKey}@${previousTimeId}`,
      );
      await internals(store).db.insert(route, {
        [tableKey]: { _type: 'components', _data: [row] },
      });
    };

    const tipTimeIdOf = async (tableKey: string, hash: string) => {
      const history = (await historyOf(store, tableKey)) as Record<
        string,
        unknown
      >[];
      const row = history.find(
        (candidate) => candidate[`${tableKey}Ref`] === hash,
      );
      expect(row).toBeDefined();
      return row!.timeId as string;
    };

    it('lists the new version of a species once, and the animals still join the version they reference', async () => {
      const duck = speciesSeed.find((species) => species.id === 'duck')!;
      const renamed = hashed({ ...duck, _hash: undefined, name: 'Mallard' });
      await insertVersion(
        'species',
        renamed,
        await tipTimeIdOf('species', duck._hash),
      );

      const species = await store.listSpecies();

      expect(species).toHaveLength(speciesSeed.length);
      expect(species.find((row) => row.id === 'duck')).toStrictEqual(renamed);
      const donald = await store.getAnimal('donald-the-third');
      expect(donald?.speciesId).toBe('duck');
      expect(donald?.speciesName).toBe('Duck');
      expect(await store.listAnimals({ speciesId: 'duck' })).toHaveLength(
        (await store.listAnimals()).filter(
          (animal) => animal.speciesId === 'duck',
        ).length,
      );
    });

    it('lists the new version of a trait once and keeps filtering by the trait id through every version', async () => {
      const loyal = traitsSeed.find((trait) => trait.id === 'fiercely-loyal')!;
      const renamed = hashed({ ...loyal, _hash: undefined, name: 'Loyal' });
      await insertVersion(
        'traits',
        renamed,
        await tipTimeIdOf('traits', loyal._hash),
      );
      const carriersBefore = animalsSeed.filter((animal) =>
        animal.traitsRefs.includes(loyal._hash),
      ).length;

      const traits = await store.listTraits();

      expect(traits).toHaveLength(traitsSeed.length);
      expect(traits.find((trait) => trait.id === 'fiercely-loyal')?.name).toBe(
        'Loyal',
      );
      expect(
        await store.listAnimals({ traitId: 'fiercely-loyal' }),
      ).toHaveLength(carriersBefore);
    });

    it('lists the new version of a breeder and of a customer once each', async () => {
      const farm = breedersSeed[0]!;
      const renamedFarm = hashed({
        ...farm,
        _hash: undefined,
        farmName: 'Grandma Duck Estates',
      });
      await insertVersion(
        'breeders',
        renamedFarm,
        await tipTimeIdOf('breeders', farm._hash),
      );
      const customer = (await store.listCustomers())[0]!;
      const renumbered = hashed({
        id: customer.id,
        personRef: (
          (await rowsOf(store, 'customers')).find(
            (row) => row._hash === customer.hash,
          ) as { personRef: string }
        ).personRef,
        customerNumber: 'C-9000',
      });
      await insertVersion(
        'customers',
        renumbered,
        await tipTimeIdOf('customers', customer.hash),
      );

      const breeders = await store.listBreeders();
      const customers = await store.listCustomers();

      expect(breeders).toHaveLength(breedersSeed.length);
      expect(breeders.find((breeder) => breeder.id === farm.id)?.farmName).toBe(
        'Grandma Duck Estates',
      );
      expect(customers).toHaveLength(5);
      expect(
        customers.find((candidate) => candidate.id === customer.id)
          ?.customerNumber,
      ).toBe('C-9000');
    });

    it('issues an invoice against the current version of a customer', async () => {
      const customer = (await store.listCustomers())[0]!;
      const personRef = (
        (await rowsOf(store, 'customers')).find(
          (row) => row._hash === customer.hash,
        ) as { personRef: string }
      ).personRef;
      const renumbered = hashed({
        id: customer.id,
        personRef,
        customerNumber: 'C-9000',
      });
      await insertVersion(
        'customers',
        renumbered,
        await tipTimeIdOf('customers', customer.hash),
      );

      const issued = await store.issueInvoice({
        customerId: customer.id,
        items: [{ animalId: 'donald-the-third', quantity: 1 }],
      });

      expect(issued.customer?.customerNumber).toBe('C-9000');
    });

    it('lists a conflicting animal once, with its newest tip, instead of twice or not at all', async () => {
      const donald = seedAnimal('donald-the-third');
      const baseTimeId = await tipTimeIdOf('animals', donald._hash);
      const left = hashed({ ...donald, _hash: undefined, priceCents: 1 });
      const right = hashed({ ...donald, _hash: undefined, priceCents: 2 });
      await insertVersion('animals', left, baseTimeId);
      await insertVersion('animals', right, baseTimeId);

      const animals = await store.listAnimals();
      const history = (await store.getAnimalHistory('donald-the-third'))!;

      expect(
        animals.filter((animal) => animal.id === 'donald-the-third'),
      ).toHaveLength(1);
      expect(history).toHaveLength(3);
      expect(history.filter((version) => version.current)).toHaveLength(2);
      expect(history[2]!.current).toBe(false);
      expect((await store.getAnimal('donald-the-third'))?.hash).toBe(
        history[0]!.hash,
      );
    });

    it('lists an invoice whose row was written twice only once', async () => {
      const invoices = (await rowsOf(store, 'invoices')) as {
        _hash: string;
        id: string;
      }[];
      const first = invoices.find(
        (invoice) => invoice.id === 'invoice-2026-0001',
      )!;
      await insertVersion(
        'invoices',
        first,
        await tipTimeIdOf('invoices', first._hash),
      );

      const listed = await store.listInvoices();

      expect(
        listed.filter((invoice) => invoice.id === 'invoice-2026-0001'),
      ).toHaveLength(1);
      expect(listed).toHaveLength(6);
    });

    it('does not list an animal that a peer wrote without an InsertHistory row', async () => {
      const ghost = hashed({
        id: 'ghost',
        name: 'Ghost',
        speciesRef: speciesSeed[0]!._hash,
        breederRef: breedersSeed[0]!._hash,
        bornOn: '2020-01-01',
        priceCents: 1,
        backgroundStory: 'Written straight into the table.',
        traitsRefs: [],
      });
      await (
        store as unknown as {
          db: {
            core: {
              import: (tree: unknown, options: unknown) => Promise<unknown>;
            };
          };
        }
      ).db.core.import(
        { [animalsTableCfg.key]: { _type: 'components', _data: [ghost] } },
        { validate: false },
      );

      const animals = await store.listAnimals();

      expect(animals.find((animal) => animal.id === 'ghost')).toBeUndefined();
      expect(await store.getAnimal('ghost')).toBeUndefined();
    });
  });

  describe('PetShopStore animal detail shape after an edit', () => {
    it('serves the same keys as before the edit', async () => {
      const store = await testStore({
        storage,
        dataDirectory: dataDirectories.next(),
      });
      await store.seedIfEmpty();
      try {
        const before = (await store.getAnimal(
          'donald-the-third',
        )) as AnimalDetail;
        const after = (await store.updateAnimal('donald-the-third', {
          priceCents: 1,
        })) as AnimalDetail;

        expect(Object.keys(after).sort()).toStrictEqual(
          Object.keys(before).sort(),
        );
      } finally {
        await store.close();
      }
    });
  });
});
