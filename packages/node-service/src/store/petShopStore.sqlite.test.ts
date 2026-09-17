import { Route, type Rljson } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  breedersSeed,
  changeSetsTableCfg,
  hashed,
  type AnimalRow,
  type ChangeSetItem,
  type HashedAnimalRow,
} from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import {
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import type { PetShopStore } from './petShopStore.ts';

/**
 * `PetShopStore.db` and `.io` are TypeScript-private fields with no runtime
 * enforcement; this narrow view reaches them to write an animal row with a
 * story of a chosen length (the store has no public animal write before
 * slice B9) and to read rows back by table and hash exactly as they are
 * stored, without the joins the public methods add.
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

/**
 * A story that exercises what a SQL `TEXT` column and a JSON round trip
 * can get wrong: quotes of both kinds, a backslash, a newline, a tab,
 * characters outside ASCII and outside the basic multilingual plane, and
 * enough repetition to pass the 4 000 character floor of roadmap section
 * 3.5 by a margin.
 */
const demandingStory = (): string => {
  const paragraph =
    'Sir Quackington said "it\'s fine", then wrote C:\\ducks\\notes.txt.\n' +
    '\tHe likes Käsekuchen, naïve façades, 日本語 and 🦆🦆.\n';
  let story = '';
  while (story.length < 4200) {
    story += paragraph;
  }
  return story;
};

const readRowByHash = async <Row extends { _hash: string }>(
  store: PetShopStore,
  table: string,
  hash: string,
): Promise<Row> => {
  const rljson = await internals(store).io.readRows({
    table,
    where: { _hash: hash },
  });
  const rows = rljson[table]!._data as Row[];
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

const bytesOf = (text: string): Buffer => Buffer.from(text, 'utf-8');

const dataDirectories = useTemporaryDataDirectories();

describe('PetShopStore over the sqlite store', () => {
  it('stores a 4 000+ character story and the traitsRefs array byte for byte', async () => {
    const dataDirectory = dataDirectories.next();
    const store = await testStore({ storage: 'sqlite', dataDirectory });
    await store.seedIfEmpty();
    const traitsRefs = animalsSeed.find(
      (animal) => animal.traitsRefs.length >= 3,
    )!.traitsRefs;
    const row: AnimalRow = {
      id: 'demanding-story-animal',
      name: 'Demanding Story Animal',
      speciesRef: animalsSeed[0]!.speciesRef,
      breederRef: breedersSeed[0]!._hash,
      bornOn: '2024-01-01',
      priceCents: 1000,
      backgroundStory: demandingStory(),
      traitsRefs: [...traitsRefs],
    };
    const written = hashed(row);
    expect(written.backgroundStory.length).toBeGreaterThan(4000);

    await internals(store).db.insert(Route.fromFlat(animalsTableCfg.key), {
      [animalsTableCfg.key]: { _type: 'components', _data: [written] },
    });
    const readBack = await readRowByHash<HashedAnimalRow>(
      store,
      animalsTableCfg.key,
      written._hash,
    );

    expect(readBack).toStrictEqual(written);
    expect(
      bytesOf(readBack.backgroundStory).equals(
        bytesOf(written.backgroundStory),
      ),
    ).toBe(true);
    expect(
      bytesOf(JSON.stringify(readBack.traitsRefs)).equals(
        bytesOf(JSON.stringify(written.traitsRefs)),
      ),
    ).toBe(true);
    expect(hashed(structuredClone(readBack))._hash).toBe(written._hash);
    expect((await store.getAnimal(row.id))?.backgroundStory).toBe(
      row.backgroundStory,
    );
    await store.close();
  });

  it('stores the items array of a change set byte for byte', async () => {
    const dataDirectory = dataDirectories.next();
    const store = await testStore({ storage: 'sqlite', dataDirectory });
    await store.seedIfEmpty();

    const issued = await store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [
        { animalId: 'donald-the-third', quantity: 1 },
        { animalId: 'sir-quackington', quantity: 2 },
      ],
    });
    const changeSet = await readRowByHash<{
      _hash: string;
      id: string;
      items: ChangeSetItem[];
    }>(store, changeSetsTableCfg.key, issued.changeSetHash!);

    expect(changeSet.items).toHaveLength(6);
    expect(changeSet.items).toContainEqual(
      expect.objectContaining({ table: 'invoices', ref: issued.hash }),
    );
    for (const item of issued.items) {
      expect(changeSet.items).toContainEqual(
        expect.objectContaining({ table: 'invoiceItems', ref: item.hash }),
      );
    }
    expect(hashed(structuredClone(changeSet))._hash).toBe(issued.changeSetHash);
    await store.close();
  });

  it('keeps an issued invoice across a restart and seeds nothing again', async () => {
    const dataDirectory = dataDirectories.next();
    const first = await testStore({ storage: 'sqlite', dataDirectory });
    const firstSeeded = await first.seedIfEmpty();
    expect(firstSeeded.invoicesSeeded).toBe(6);
    const issued = await first.issueInvoice({
      customerId: 'donald-duck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    const countsBefore = await first.tableRowCounts();
    await first.close();

    const second = await testStore({ storage: 'sqlite', dataDirectory });
    const secondSeeded = await second.seedIfEmpty();

    expect(secondSeeded).toStrictEqual({
      speciesSeeded: 0,
      traitsSeeded: 0,
      personsSeeded: 0,
      breedersSeeded: 0,
      customersSeeded: 0,
      animalsSeeded: 0,
      animalTraitsSeeded: 0,
      invoicesSeeded: 0,
    });
    expect(await second.tableRowCounts()).toStrictEqual(countsBefore);
    expect(await second.getInvoice(issued.id)).toStrictEqual(issued);
    expect(
      (await second.listInvoices()).map((invoice) => invoice.id),
    ).toContain(issued.id);
    await second.close();
  });

  it('serves the same seed as the in-memory store, in the same order', async () => {
    const memory = await testStore({
      storage: 'memory',
      dataDirectory: dataDirectories.next(),
    });
    const sqlite = await testStore({
      storage: 'sqlite',
      dataDirectory: dataDirectories.next(),
    });
    await memory.seedIfEmpty();
    await sqlite.seedIfEmpty();

    expect(await sqlite.listSpecies()).toStrictEqual(
      await memory.listSpecies(),
    );
    expect(await sqlite.listTraits()).toStrictEqual(await memory.listTraits());
    expect(await sqlite.listBreeders()).toStrictEqual(
      await memory.listBreeders(),
    );
    expect(await sqlite.listCustomers()).toStrictEqual(
      await memory.listCustomers(),
    );
    expect(await sqlite.listAnimals()).toStrictEqual(
      await memory.listAnimals(),
    );
    for (const animal of animalsSeed) {
      expect(await sqlite.getAnimal(animal.id)).toStrictEqual(
        await memory.getAnimal(animal.id),
      );
    }
    expect(await sqlite.listInvoices()).toStrictEqual(
      await memory.listInvoices(),
    );
    expect(await sqlite.tableRowCounts()).toStrictEqual(
      await memory.tableRowCounts(),
    );
    await memory.close();
    await sqlite.close();
  });
});
