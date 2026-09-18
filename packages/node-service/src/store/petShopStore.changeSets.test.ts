import { hashed, type HashedChangeSetRow } from '@rljson-tryout/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import type { ChangeSetPayload, PetShopStore } from './petShopStore.ts';

const dataDirectories = useTemporaryDataDirectories();

/**
 * Runs `write` and returns the change set it made the store announce.
 */
const changeSetWrittenBy = async (
  store: PetShopStore,
  write: () => Promise<unknown>,
): Promise<HashedChangeSetRow> => {
  const written: HashedChangeSetRow[] = [];
  const unsubscribe = store.onChangeSetWritten((changeSet) => {
    written.push(changeSet);
  });
  try {
    await write();
  } finally {
    unsubscribe();
  }
  expect(written).toHaveLength(1);
  return written[0]!;
};

const itemsOf = (payload: ChangeSetPayload, table: string) =>
  payload.items.filter((item) => item.table === table);

describe.each(storageKinds)('over the %s store', (storage) => {
  describe('PetShopStore.changeSetPayload', () => {
    let store: PetShopStore;

    beforeEach(async () => {
      store = await testStore({
        storage,
        dataDirectory: dataDirectories.next(),
      });
      await store.seedIfEmpty();
    });

    afterEach(() => store.close());

    it('shows an edited animal next to the version it supersedes, junction rows included', async () => {
      const changeSet = await changeSetWrittenBy(store, () =>
        store.updateAnimal('bowser-the-guard-dog', {
          name: 'Bowser the Retired Guard Dog',
        }),
      );

      const payload = await store.changeSetPayload(changeSet._hash);

      expect(payload).toBeDefined();
      expect(payload!.hash).toBe(changeSet._hash);
      expect(payload!.id).toBe(changeSet.id);
      expect(
        payload!.items.map((item) => [item.table, item.ref]),
      ).toStrictEqual(changeSet.items.map((item) => [item.table, item.ref]));
      const [animal] = itemsOf(payload!, 'animals');
      expect(animal!.row).toMatchObject({
        _hash: animal!.ref,
        id: 'bowser-the-guard-dog',
        name: 'Bowser the Retired Guard Dog',
      });
      expect(animal!.previousRow).toMatchObject({
        id: 'bowser-the-guard-dog',
        name: 'Bowser the Guard Dog',
        priceCents: animal!.row!.priceCents,
      });
      expect(animal!.previousRow!._hash).not.toBe(animal!.ref);
      const [history] = itemsOf(payload!, 'animalsInsertHistory');
      expect(history!.row).toMatchObject({
        animalsRef: animal!.ref,
        previous: [expect.stringMatching(/^\d+:seed$/)],
      });
      expect(history!.previousRow).toBeNull();
      const pairings = itemsOf(payload!, 'animalTraits');
      expect(pairings.length).toBeGreaterThan(0);
      for (const pairing of pairings) {
        expect(pairing.row).toMatchObject({ animalRef: animal!.ref });
        expect(pairing.previousRow).toMatchObject({
          traitRef: pairing.row!.traitRef,
          animalRef: animal!.previousRow!._hash,
        });
      }
      for (const item of itemsOf(payload!, 'animalTraitsInsertHistory')) {
        expect(item.previousRow).toBeNull();
      }
    });

    it('shows a seeded change set with rows and no predecessors', async () => {
      const [oldest] = await store.heldChangeSets();

      const payload = await store.changeSetPayload(oldest!.hash);

      expect(payload).toBeDefined();
      expect(payload!.items.length).toBeGreaterThan(0);
      for (const item of payload!.items) {
        expect(item.row).toMatchObject({ _hash: item.ref });
        expect(item.previousRow).toBeNull();
      }
    });

    it('shows an issued invoice with its items and no predecessors', async () => {
      const [customer] = await store.listCustomers();
      const changeSet = await changeSetWrittenBy(store, () =>
        store.issueInvoice({
          customerId: customer!.id,
          items: [{ animalId: 'bowser-the-guard-dog', quantity: 1 }],
        }),
      );

      const payload = await store.changeSetPayload(changeSet._hash);

      expect(payload!.items.map((item) => item.table).sort()).toStrictEqual([
        'invoiceItems',
        'invoiceItemsInsertHistory',
        'invoices',
        'invoicesInsertHistory',
      ]);
      const [invoice] = itemsOf(payload!, 'invoices');
      expect(invoice!.row).toMatchObject({ customerRef: expect.any(String) });
      const [invoiceItem] = itemsOf(payload!, 'invoiceItems');
      expect(invoiceItem!.row).toMatchObject({
        invoiceRef: invoice!.ref,
        quantity: 1,
      });
      for (const item of payload!.items) {
        expect(item.previousRow).toBeNull();
      }
    });

    it('answers nothing for a change set this store does not hold or an unsafe hash', async () => {
      expect(
        await store.changeSetPayload('NoSuchChangeSetHash00'),
      ).toBeUndefined();
      expect(await store.changeSetPayload("' or 1=1 --")).toBeUndefined();
    });

    it('leaves the row of an item this store lacks null instead of failing', async () => {
      const changeSet = hashed({
        id: 'recorded-without-rows',
        items: [
          { table: 'animals', ref: 'MissingAnimalRowHash00' },
          { table: 'nowhere', ref: 'MissingTableRowHash000' },
        ],
      });
      await store.recordReceivedChangeSet(changeSet);

      const payload = await store.changeSetPayload(changeSet._hash);

      expect(payload).toStrictEqual({
        hash: changeSet._hash,
        id: 'recorded-without-rows',
        items: [
          {
            table: 'animals',
            ref: 'MissingAnimalRowHash00',
            row: null,
            previousRow: null,
          },
          {
            table: 'nowhere',
            ref: 'MissingTableRowHash000',
            row: null,
            previousRow: null,
          },
        ],
      });
    });
  });
});
