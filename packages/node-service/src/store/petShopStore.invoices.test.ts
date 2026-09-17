import { Route, type InsertHistoryRow, type Rljson } from '@rljson/rljson';
import {
  animalsSeed,
  customersSeed,
  customersTableCfg,
  hashed,
  invoicesSeed,
  personsSeed,
  speciesSeed,
  type InvoiceSeedEntry,
} from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  validatableDocument,
  validationErrors,
} from '../testing/storeDocument.ts';
import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import { InvoiceValidationError, type PetShopStore } from './petShopStore.ts';

/**
 * `PetShopStore.db` and `.io` are TypeScript-private fields with no runtime
 * enforcement; this narrow view reaches them to write a row the seed never
 * writes (a customer with a dangling `personRef`), to read a row back by
 * table and hash exactly as a peer pulling a change set would, and to dump
 * the whole store for the rljson validator.
 */
type StoreInternals = {
  db: { insert: (route: Route, tree: unknown) => Promise<unknown> };
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

const priceOf = (animalId: string): number => {
  const animal = animalsSeed.find((row) => row.id === animalId);
  expect(animal).toBeDefined();
  return animal!.priceCents;
};

const expectedTotalOf = (entry: InvoiceSeedEntry): number =>
  entry.items.reduce(
    (total, item) => total + item.quantity * priceOf(item.animalId),
    0,
  );

const personNameOf = (customerId: string): string => {
  const customer = customersSeed.find((row) => row.id === customerId);
  const person = personsSeed.find((row) => row._hash === customer?.personRef);
  expect(person).toBeDefined();
  return person!.name;
};

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describe('PetShopStore customers and invoices', () => {
    let store: PetShopStore;

    beforeEach(async () => {
      store = await testStore(
        { storage, dataDirectory: dataDirectories.next() },
        { today: () => '2026-09-17' },
      );
      await store.seedIfEmpty();
    });

    afterEach(async () => {
      await store.close();
    });

    describe('listCustomers', () => {
      it('lists the customers ordered by customer number, with their person joined, in the documented shape', async () => {
        const byPersonHash = new Map(
          personsSeed.map((person) => [person._hash, person]),
        );
        const customers = await store.listCustomers();

        const numbers = customers.map((customer) => customer.customerNumber);
        expect(numbers).toStrictEqual([...numbers].sort());
        expect(numbers).toHaveLength(5);

        for (const seedRow of customersSeed) {
          const expectedPerson = byPersonHash.get(seedRow.personRef);
          expect(expectedPerson).toBeDefined();
          expect(
            customers.find((customer) => customer.id === seedRow.id),
          ).toStrictEqual({
            id: seedRow.id,
            hash: seedRow._hash,
            customerNumber: seedRow.customerNumber,
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
          id: 'ghost-customer',
          personRef: 'no-such-person-hash',
          customerNumber: 'C-9999',
        });
        await internals(store).db.insert(
          Route.fromFlat(customersTableCfg.key),
          {
            [customersTableCfg.key]: { _type: 'components', _data: [ghost] },
          },
        );

        const customers = await store.listCustomers();

        expect(customers).toHaveLength(6);
        expect(customers.at(-1)).toStrictEqual({
          id: 'ghost-customer',
          hash: ghost._hash,
          customerNumber: 'C-9999',
          person: null,
        });
      });
    });

    describe('listInvoices', () => {
      it('lists the six seeded invoices newest number first, in the documented shape', async () => {
        const invoices = await store.listInvoices();

        expect(invoices.map((invoice) => invoice.invoiceNumber)).toStrictEqual([
          '2026-0006',
          '2026-0005',
          '2026-0004',
          '2026-0003',
          '2026-0002',
          '2026-0001',
        ]);
        for (const [index, entry] of [...invoicesSeed].reverse().entries()) {
          expect(invoices[index]).toStrictEqual({
            id: `invoice-${invoices[index]!.invoiceNumber}`,
            hash: expect.any(String) as string,
            invoiceNumber: invoices[index]!.invoiceNumber,
            issuedOn: entry.issuedOn,
            status: entry.status,
            customer: {
              id: entry.customerId,
              customerNumber: customersSeed.find(
                (customer) => customer.id === entry.customerId,
              )!.customerNumber,
              personName: personNameOf(entry.customerId),
            },
            totalCents: expectedTotalOf(entry),
            itemCount: entry.items.length,
          });
        }
      });

      it('has at least two open invoices after seeding', async () => {
        const invoices = await store.listInvoices();

        expect(
          invoices.filter((invoice) => invoice.status === 'open').length,
        ).toBeGreaterThanOrEqual(2);
      });
    });

    describe('getInvoice', () => {
      it('returns undefined for an unknown id', async () => {
        expect(await store.getInvoice('no-such-invoice')).toBeUndefined();
      });

      it('returns the invoice with its customer, items, animals, total and change set hash', async () => {
        const entry = invoicesSeed[3]!;
        const invoice = await store.getInvoice('invoice-2026-0004');

        expect(invoice).toBeDefined();
        expect(invoice).toMatchObject({
          id: 'invoice-2026-0004',
          invoiceNumber: '2026-0004',
          issuedOn: entry.issuedOn,
          status: entry.status,
          customer: {
            id: entry.customerId,
            customerNumber: 'C-0004',
            person: {
              id: 'fethry-duck',
              name: 'Fethry Duck',
              city: 'Duckburg',
            },
          },
          totalCents: expectedTotalOf(entry),
        });
        expect(invoice!.changeSetHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(invoice!.items).toStrictEqual(
          entry.items.map((item, index) => {
            const animal = animalsSeed.find((row) => row.id === item.animalId)!;
            const species = speciesSeed.find(
              (row) => row._hash === animal.speciesRef,
            )!;
            return {
              id: `invoice-2026-0004-item-${index + 1}`,
              hash: expect.any(String) as string,
              animal: {
                id: animal.id,
                name: animal.name,
                speciesName: species.name,
              },
              quantity: item.quantity,
              unitPriceCents: animal.priceCents,
              lineTotalCents: item.quantity * animal.priceCents,
            };
          }),
        );
      });

      it('names a change set whose every item resolves to a stored row, InsertHistory rows included', async () => {
        const invoice = (await store.getInvoice('invoice-2026-0004'))!;
        const { changeSets } = await internals(store).io.readRows({
          table: 'changeSets',
          where: { _hash: invoice.changeSetHash! },
        });
        const [changeSet] = changeSets._data as {
          id: string;
          items: { table: string; ref: string }[];
        }[];

        expect(changeSet.id).toBe('issue-invoice-2026-0004');
        expect(changeSet.items.map((item) => item.table)).toStrictEqual([
          'invoices',
          'invoicesInsertHistory',
          'invoiceItems',
          'invoiceItemsInsertHistory',
          'invoiceItems',
          'invoiceItemsInsertHistory',
        ]);
        expect(changeSet.items[0]!.ref).toBe(invoice.hash);
        expect(changeSet.items[2]!.ref).toBe(invoice.items[0]!.hash);
        expect(changeSet.items[4]!.ref).toBe(invoice.items[1]!.hash);

        for (const item of changeSet.items) {
          const rljson = await internals(store).io.readRows({
            table: item.table,
            where: { _hash: item.ref },
          });
          expect(rljson[item.table]!._data).toHaveLength(1);
        }
      });

      it('records one InsertHistory row per change set', async () => {
        const { changeSetsInsertHistory } = await internals(store).io.readRows({
          table: 'changeSetsInsertHistory',
          where: {},
        });

        expect(changeSetsInsertHistory._data).toHaveLength(invoicesSeed.length);
        for (const row of changeSetsInsertHistory._data as InsertHistoryRow<string>[]) {
          expect(row).toMatchObject({
            route: '/changeSets',
            origin: 'core.import',
            previous: [],
          });
          expect(row.timeId).toMatch(/^\d+:.{4}$/);
        }
      });
    });

    describe('issueInvoice', () => {
      const command = {
        customerId: 'scrooge-mcduck',
        items: [
          { animalId: 'donald-the-third', quantity: 1 },
          { animalId: 'henrietta-the-egg-champion', quantity: 2 },
        ],
      };

      it('writes the invoice, its items and one change set, and returns the invoice as getInvoice serves it', async () => {
        const issued = await store.issueInvoice(command);

        expect(issued).toMatchObject({
          id: 'invoice-2026-0007',
          invoiceNumber: '2026-0007',
          issuedOn: '2026-09-17',
          status: 'open',
          customer: {
            id: 'scrooge-mcduck',
            customerNumber: 'C-0001',
            person: { id: 'scrooge-mcduck', name: 'Scrooge McDuck' },
          },
          totalCents: 52000 + 2 * 19500,
        });
        expect(issued.items).toMatchObject([
          {
            id: 'invoice-2026-0007-item-1',
            animal: { id: 'donald-the-third', name: 'Donald the Third' },
            quantity: 1,
            unitPriceCents: 52000,
            lineTotalCents: 52000,
          },
          {
            id: 'invoice-2026-0007-item-2',
            animal: { id: 'henrietta-the-egg-champion' },
            quantity: 2,
            unitPriceCents: 19500,
            lineTotalCents: 39000,
          },
        ]);
        expect(issued.changeSetHash).toMatch(/^[A-Za-z0-9_-]{22}$/);

        expect(await store.getInvoice('invoice-2026-0007')).toStrictEqual(
          issued,
        );
        const invoices = await store.listInvoices();
        expect(invoices).toHaveLength(7);
        expect(invoices[0]).toMatchObject({
          id: 'invoice-2026-0007',
          totalCents: 91000,
          itemCount: 2,
        });
      });

      it('dates the invoice with the injected clock and starts the sequence of a new year at one, not at the row count', async () => {
        const laterStore = await testStore(
          { storage, dataDirectory: dataDirectories.next() },
          { today: () => '2031-01-02' },
        );
        await laterStore.seedIfEmpty();

        const issued = await laterStore.issueInvoice(command);
        const next = await laterStore.issueInvoice(command);

        expect(issued.issuedOn).toBe('2031-01-02');
        expect(issued.invoiceNumber).toBe('2031-0001');
        expect(next.invoiceNumber).toBe('2031-0002');
        await laterStore.close();
      });

      it('gives concurrent calls consecutive invoice numbers', async () => {
        const issued = await Promise.all([
          store.issueInvoice(command),
          store.issueInvoice(command),
          store.issueInvoice(command),
        ]);

        expect(issued.map((invoice) => invoice.invoiceNumber)).toStrictEqual([
          '2026-0007',
          '2026-0008',
          '2026-0009',
        ]);
        expect(await store.listInvoices()).toHaveLength(9);
      });

      it.each([
        [
          'no items',
          { customerId: 'scrooge-mcduck', items: [] },
          'An invoice needs at least one item.',
        ],
        [
          'a quantity of zero',
          {
            customerId: 'scrooge-mcduck',
            items: [{ animalId: 'donald-the-third', quantity: 0 }],
          },
          'Item 1: the quantity must be a whole number of at least 1, got 0.',
        ],
        [
          'a fractional quantity',
          {
            customerId: 'scrooge-mcduck',
            items: [
              { animalId: 'donald-the-third', quantity: 1 },
              { animalId: 'daphne-duck', quantity: 1.5 },
            ],
          },
          'Item 2: the quantity must be a whole number of at least 1, got 1.5.',
        ],
        [
          'an unknown customer',
          {
            customerId: 'magica-de-spell',
            items: [{ animalId: 'donald-the-third', quantity: 1 }],
          },
          'No customer with id "magica-de-spell".',
        ],
        [
          'an unknown animal',
          {
            customerId: 'scrooge-mcduck',
            items: [
              { animalId: 'donald-the-third', quantity: 1 },
              { animalId: 'gizmoduck', quantity: 1 },
            ],
          },
          'No animal with id "gizmoduck".',
        ],
      ])(
        'rejects a command with %s and writes nothing',
        async (_description, invalidCommand, message) => {
          await expect(store.issueInvoice(invalidCommand)).rejects.toThrow(
            new InvoiceValidationError(message),
          );

          expect(await store.listInvoices()).toHaveLength(6);
          const { invoiceItems } = await internals(store).io.readRows({
            table: 'invoiceItems',
            where: {},
          });
          expect(invoiceItems._data).toHaveLength(
            invoicesSeed.reduce(
              (count, entry) => count + entry.items.length,
              0,
            ),
          );
        },
      );

      it('keeps issuing after a rejected command', async () => {
        await expect(
          store.issueInvoice({ customerId: 'scrooge-mcduck', items: [] }),
        ).rejects.toThrow(InvoiceValidationError);

        const issued = await store.issueInvoice(command);

        expect(issued.invoiceNumber).toBe('2026-0007');
      });
    });

    describe('store integrity', () => {
      it('validates as one rljson document with every reference and every change set item resolved', async () => {
        await store.issueInvoice({
          customerId: 'donald-duck',
          items: [{ animalId: 'donald-the-third', quantity: 1 }],
        });

        const errors = await validationErrors(
          validatableDocument(await internals(store).io.dump()),
        );

        expect(errors).toStrictEqual({});
      });
    });
  });
});
