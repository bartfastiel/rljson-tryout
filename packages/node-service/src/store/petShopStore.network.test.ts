import { IoMem, IoMulti, type Io } from '@rljson/io';
import { afterEach, describe, expect, it } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import { memoryStore } from '../testing/testStores.ts';
import { PetShopStore } from './petShopStore.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * Two seeded stores and a read cascade from the second into the first,
 * built the way `Client` of `@rljson/server` builds its `IoMulti` (the
 * local store first, read and write; the hub's store read-only behind it)
 * but in one process, so that the store's fallback reads are exercised
 * without a socket. The hub transport tests cover the same over socket.io.
 */
const hubAndClient = async () => {
  const hub = await memoryStore();
  const client = await memoryStore();
  cleanups.push(
    () => hub.close(),
    () => client.close(),
  );
  await hub.seedIfEmpty();
  await client.seedIfEmpty();
  const cascade = new IoMulti([
    { io: client.localIo, priority: 1, read: true, write: true, dump: true },
    { io: hub.localIo, priority: 2, read: true, write: false, dump: false },
  ]);
  await cascade.init();
  client.readThrough(() => cascade);
  return { hub, client };
};

describe('PetShopStore reading through the network', () => {
  it('reads locally until a cascade is set', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());

    expect(store.readsThroughNetwork).toBe(false);
    store.readThrough(() => store.localIo);
    expect(store.readsThroughNetwork).toBe(true);
    store.readThrough(null);
    expect(store.readsThroughNetwork).toBe(false);
  });

  it('serves an animal version written on the hub by its hash, without making it current', async () => {
    const { hub, client } = await hubAndClient();
    const before = await client.getAnimal('donald-the-third');
    const updated = await hub.updateAnimal('donald-the-third', {
      priceCents: 61_000,
    });
    expect(await client.localIo.rowCount('animals')).toBe(10);

    const byHash = await client.getAnimal('donald-the-third', {
      version: updated!.hash,
    });

    expect(byHash).toMatchObject({
      id: 'donald-the-third',
      hash: updated!.hash,
      priceCents: 61_000,
      speciesName: before!.speciesName,
      breeder: before!.breeder,
    });
    expect(await client.localIo.rowCount('animals')).toBe(11);
    expect(await client.getAnimal('donald-the-third')).toStrictEqual(before);
    expect(
      (await client.getAnimalHistory('donald-the-third'))!.map(
        (version) => version.hash,
      ),
    ).toStrictEqual([before!.hash]);
  });

  it('does not serve a version by hash under another animal id', async () => {
    const { hub, client } = await hubAndClient();
    const updated = await hub.updateAnimal('donald-the-third', {
      priceCents: 61_000,
    });

    expect(
      await client.getAnimal('sir-quackington', { version: updated!.hash }),
    ).toBeUndefined();
  });

  it('serves an invoice issued on the hub by its id with its items, without listing it', async () => {
    const { hub, client } = await hubAndClient();
    const issued = await hub.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    const listedBefore = await client.listInvoices();
    expect(listedBefore.map((invoice) => invoice.id)).not.toContain(issued.id);

    const fetched = await client.getInvoice(issued.id);

    expect(fetched).toStrictEqual({ ...issued, changeSetHash: null });
    expect(fetched!.items[0]?.animal?.id).toBe('donald-the-third');
    expect(fetched!.customer?.person?.name).toBe('Scrooge McDuck');
    expect(await client.listInvoices()).toStrictEqual(listedBefore);
    expect(await client.getInvoice('invoice-2099-0001')).toBeUndefined();
  });

  it('resolves references of a remote invoice that the local tables lack', async () => {
    const { hub, client } = await hubAndClient();
    const animal = await hub.updateAnimal('donald-the-third', {
      priceCents: 61_000,
    });
    const issued = await hub.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 2 }],
    });

    const fetched = await client.getInvoice(issued.id);

    expect(fetched!.items).toStrictEqual(issued.items);
    expect(fetched!.items[0]?.unitPriceCents).toBe(animal!.priceCents);
    expect(fetched!.totalCents).toBe(122_000);
  });

  it('prefers a local invoice over a remote one with the same id', async () => {
    const { hub, client } = await hubAndClient();
    const remote = await hub.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    const local = await client.issueInvoice({
      customerId: 'donald-duck',
      items: [{ animalId: 'quackmore-junior', quantity: 1 }],
    });
    expect(local.id).toBe(remote.id);

    const fetched = await client.getInvoice(remote.id);

    expect(fetched).toStrictEqual(local);
  });

  it('refuses to send an unsafe id or hash into a where clause', async () => {
    const { client } = await hubAndClient();

    expect(
      await client.getInvoice("invoice-2026-0001' OR '1'='1"),
    ).toBeUndefined();
    expect(
      await client.getAnimal('donald-the-third', { version: 'a b' }),
    ).toBeUndefined();
  });

  it('answers with local data and logs a warning when the cascade cannot answer', async () => {
    const { logger, records } = recordingLogger();
    const hub = await memoryStore();
    const client = await memoryStore({ logger });
    cleanups.push(
      () => hub.close(),
      () => client.close(),
    );
    await hub.seedIfEmpty();
    await client.seedIfEmpty();
    const issued = await hub.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    const failing: Io = {
      ...client.localIo,
      readRows: () => Promise.reject(new Error('Io "io-1" is closed')),
    };
    client.readThrough(() => failing);

    expect(await client.getInvoice(issued.id)).toBeUndefined();
    expect(await client.getInvoice('invoice-2026-0001')).toBeDefined();
    expect((await client.listAnimals()).total).toBe(10);
    expect(records).toContainEqual({
      level: 'warn',
      message: 'read through the network failed, answering from local data',
      fields: {
        err: expect.any(Error) as Error,
        table: 'invoices',
        where: { id: issued.id },
      },
    });
  });

  it('keeps the single-node behaviour when the cascade is the local store itself', async () => {
    const store = new PetShopStore(new IoMem());
    cleanups.push(() => store.close());
    await store.initialize();
    await store.seedIfEmpty();
    store.readThrough(() => store.localIo);

    const invoice = await store.getInvoice('invoice-2026-0001');

    expect(invoice?.changeSetHash).not.toBeNull();
    expect(await store.getInvoice('invoice-2099-0001')).toBeUndefined();
  });
});
