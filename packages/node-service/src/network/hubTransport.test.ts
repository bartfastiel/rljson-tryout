import { connect, createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import { buildTestTransport } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';
import type { PetShopStore } from '../store/petShopStore.ts';
import { HubTransport, type TransportStore } from './hubTransport.ts';
import { BorrowedIo } from '../store/borrowedIo.ts';
import { BsMem } from '@rljson/bs';
import type { TableCfg } from '@rljson/rljson';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const seededStore = async (): Promise<PetShopStore> => {
  const store = await memoryStore();
  await store.seedIfEmpty();
  cleanups.push(() => store.close());
  return store;
};

const transportOver = (store: PetShopStore): HubTransport => {
  const transport = buildTestTransport(store);
  cleanups.push(() => transport.stop());
  return transport;
};

/** A hub on an ephemeral port and its address as a client connects to it. */
const hub = async () => {
  const store = await seededStore();
  const transport = transportOver(store);
  await transport.becomeHub('127.0.0.1:0');
  const port = transport.boundPort();
  expect(port).not.toBeNull();
  return { store, transport, address: `127.0.0.1:${port}` };
};

const client = async (address: string) => {
  const store = await seededStore();
  const transport = transportOver(store);
  await transport.becomeClient(address);
  return { store, transport };
};

const until = async (
  condition: () => boolean,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Completes a TCP handshake with the port and reports how it went. */
const probe = (port: number): Promise<'open' | 'refused'> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve('open');
    });
    socket.once('error', () => resolve('refused'));
  });

const occupyPort = (): Promise<{ port: number; blocker: Server }> =>
  new Promise((resolve) => {
    const blocker = createServer();
    cleanups.push(
      () => new Promise<void>((done) => blocker.close(() => done())),
    );
    blocker.listen(0, '0.0.0.0', () => {
      const address = blocker.address();
      resolve({
        port:
          typeof address === 'string' || address === null ? 0 : address.port,
        blocker,
      });
    });
  });

describe('HubTransport as hub', () => {
  it('serves on an ephemeral port and reports no clients', async () => {
    const { transport } = await hub();

    expect(transport.snapshot()).toStrictEqual({
      role: 'hub',
      hubAddress: '127.0.0.1:0',
      connectedClients: 0,
      lastError: null,
    });
    expect(await probe(transport.boundPort()!)).toBe('open');
  });

  it('keeps its server when asked to become hub again', async () => {
    const { transport } = await hub();
    const port = transport.boundPort();

    await transport.becomeHub('10.0.0.2:3000');

    expect(transport.boundPort()).toBe(port);
    expect(transport.snapshot()).toMatchObject({
      role: 'hub',
      hubAddress: '10.0.0.2:3000',
    });
  });

  it('routes the store reads through the server multi while hub', async () => {
    const { store, transport } = await hub();

    expect(store.readsThroughNetwork).toBe(true);
    await transport.becomeStandalone();
    expect(store.readsThroughNetwork).toBe(false);
  });

  it('gives up a busy port after the configured attempts and reports it', async () => {
    const { port } = await occupyPort();
    const store = await seededStore();
    const { logger, records } = recordingLogger();
    const transport = new HubTransport(
      { hubPort: port },
      logger,
      store,
      new BsMem(),
      { bindAttempts: 2, bindRetryDelayMs: 10 },
    );
    cleanups.push(() => transport.stop());

    await transport.becomeHub('127.0.0.1:0');

    expect(transport.snapshot()).toMatchObject({
      role: 'standalone',
      lastError: expect.stringContaining('EADDRINUSE') as string,
    });
    expect(store.readsThroughNetwork).toBe(false);
    expect(store.localIo.isOpen).toBe(true);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'hub transport transition failed',
      }),
    );
  });
});

describe('HubTransport as client', () => {
  it('connects to the hub, which counts it', async () => {
    const hubNode = await hub();

    const clientNode = await client(hubNode.address);
    await until(
      () =>
        clientNode.transport.snapshot().role === 'client' &&
        (clientNode.transport.snapshot() as { connectedToHub: boolean })
          .connectedToHub,
    );

    expect(clientNode.transport.snapshot()).toStrictEqual({
      role: 'client',
      hubAddress: hubNode.address,
      connectedToHub: true,
      lastError: null,
    });
    await until(
      () =>
        (hubNode.transport.snapshot() as { connectedClients: number })
          .connectedClients === 1,
    );
    expect(clientNode.store.readsThroughNetwork).toBe(true);
  });

  it('reads a row written on the hub by hash through the multi and caches it', async () => {
    const hubNode = await hub();
    const clientNode = await client(hubNode.address);
    await until(() => clientNode.store.readsThroughNetwork);
    const updated = await hubNode.store.updateAnimal('donald-the-third', {
      priceCents: 61_000,
    });
    expect(await clientNode.store.localIo.rowCount('animals')).toBe(10);

    const byHash = await clientNode.store.getAnimal('donald-the-third', {
      version: updated!.hash,
    });

    expect(byHash).toMatchObject({ hash: updated!.hash, priceCents: 61_000 });
    expect(await clientNode.store.localIo.rowCount('animals')).toBe(11);
    expect(
      (await clientNode.store.getAnimal('donald-the-third'))?.hash,
    ).not.toBe(updated!.hash);
  });

  it('lets the hub read a row written on a client by hash', async () => {
    const hubNode = await hub();
    const clientNode = await client(hubNode.address);
    await until(
      () =>
        (hubNode.transport.snapshot() as { connectedClients: number })
          .connectedClients === 1,
    );
    const updated = await clientNode.store.updateAnimal('donald-the-third', {
      priceCents: 62_000,
    });

    const byHash = await hubNode.store.getAnimal('donald-the-third', {
      version: updated!.hash,
    });

    expect(byHash).toMatchObject({ hash: updated!.hash, priceCents: 62_000 });
  });

  it('serves an invoice issued on the hub by id on the client', async () => {
    const hubNode = await hub();
    const clientNode = await client(hubNode.address);
    await until(() => clientNode.store.readsThroughNetwork);
    const issued = await hubNode.store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });

    const fetched = await clientNode.store.getInvoice(issued.id);

    expect(fetched).toStrictEqual({ ...issued, changeSetHash: null });
  });

  it('keeps the connection when asked to join the same hub again', async () => {
    const hubNode = await hub();
    const clientNode = await client(hubNode.address);
    await until(() => clientNode.store.readsThroughNetwork);
    const connectedClients = () =>
      (hubNode.transport.snapshot() as { connectedClients: number })
        .connectedClients;
    await until(() => connectedClients() === 1);

    await clientNode.transport.becomeClient(hubNode.address);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(connectedClients()).toBe(1);
    expect(clientNode.transport.snapshot()).toMatchObject({
      connectedToHub: true,
      lastError: null,
    });
  });

  it('stays usable locally with the error recorded when the hub goes away', async () => {
    const hubNode = await hub();
    const clientNode = await client(hubNode.address);
    await until(() => clientNode.store.readsThroughNetwork);
    const issued = await hubNode.store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });

    await hubNode.transport.becomeStandalone();
    await until(
      () =>
        !(clientNode.transport.snapshot() as { connectedToHub: boolean })
          .connectedToHub,
    );

    expect(clientNode.transport.snapshot()).toMatchObject({
      role: 'client',
      connectedToHub: false,
      lastError: expect.stringMatching(
        /^(disconnected from hub|cannot reach hub) 127\.0\.0\.1:\d+: /u,
      ) as string,
    });
    expect(await probe(hubNode.transport.boundPort() ?? 0)).toBe('refused');
    expect(await clientNode.store.getInvoice(issued.id)).toBeUndefined();
    expect((await clientNode.store.listAnimals()).total).toBe(10);
    expect((await clientNode.store.getInvoice('invoice-2026-0001'))?.id).toBe(
      'invoice-2026-0001',
    );
  });

  it('reports a hub it cannot reach and keeps reading locally', async () => {
    const { port, blocker } = await occupyPort();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    const store = await seededStore();
    const transport = new HubTransport(
      { hubPort: 0 },
      recordingLogger().logger,
      store,
      new BsMem(),
      { connectTimeoutMs: 200 },
    );
    cleanups.push(() => transport.stop());

    await transport.becomeClient(`127.0.0.1:${port}`);

    expect(transport.snapshot()).toMatchObject({
      role: 'client',
      hubAddress: `127.0.0.1:${port}`,
      connectedToHub: false,
      lastError: expect.stringContaining('cannot reach hub') as string,
    });
    expect(store.readsThroughNetwork).toBe(false);
    expect((await store.listAnimals()).total).toBe(10);
  });
});

describe('HubTransport with a client that fails to initialize', () => {
  it('drops the socket and connects again with a fresh one once the store works', async () => {
    const hubNode = await hub();
    const clientNode = await seededStore();
    let broken = true;
    class RefusingIo extends BorrowedIo {
      override createOrExtendTable(request: {
        tableCfg: TableCfg;
      }): Promise<void> {
        return broken
          ? Promise.reject(new Error('table creation refused'))
          : super.createOrExtendTable(request);
      }
    }
    const store: TransportStore = {
      localIo: new RefusingIo(clientNode.localIo),
      readThrough: (cascade) => clientNode.readThrough(cascade),
    };
    const transport = new HubTransport(
      { hubPort: 0 },
      recordingLogger().logger,
      store,
      new BsMem(),
      { connectTimeoutMs: 300 },
    );
    cleanups.push(() => transport.stop());
    const connectedClients = () =>
      (hubNode.transport.snapshot() as { connectedClients: number })
        .connectedClients;

    await transport.becomeClient(hubNode.address);
    await until(
      () =>
        transport.snapshot().role === 'standalone' &&
        transport.snapshot().lastError?.includes('refused') === true,
    );
    await until(() => connectedClients() === 0);

    expect(transport.snapshot()).toMatchObject({
      role: 'standalone',
      lastError: expect.stringContaining('failed to initialize') as string,
    });
    expect(clientNode.readsThroughNetwork).toBe(false);

    broken = false;
    await until(
      () =>
        transport.snapshot().role === 'client' &&
        (transport.snapshot() as { connectedToHub: boolean }).connectedToHub,
    );
    await until(() => connectedClients() === 1);

    expect(transport.snapshot().lastError).toBeNull();
    expect(clientNode.readsThroughNetwork).toBe(true);
  });
});

describe('HubTransport with a hub that changes identity behind its address', () => {
  it('keeps the client, whose socket reconnects to the new server', async () => {
    const first = await hub();
    const port = first.transport.boundPort()!;
    const clientNode = await client(first.address);
    await until(() => clientNode.store.readsThroughNetwork);

    await first.transport.becomeStandalone();
    await until(
      () =>
        !(clientNode.transport.snapshot() as { connectedToHub: boolean })
          .connectedToHub,
    );
    const secondStore = await seededStore();
    const second = new HubTransport(
      { hubPort: port },
      recordingLogger().logger,
      secondStore,
      new BsMem(),
    );
    cleanups.push(() => second.stop());
    await second.becomeHub(first.address);
    await clientNode.transport.becomeClient(first.address);

    await until(
      () =>
        (second.snapshot() as { connectedClients: number }).connectedClients ===
        1,
      10_000,
    );
    await until(
      () =>
        (clientNode.transport.snapshot() as { connectedToHub: boolean })
          .connectedToHub,
    );
    const updated = await secondStore.updateAnimal('donald-the-third', {
      priceCents: 63_000,
    });
    const byHash = await clientNode.store.getAnimal('donald-the-third', {
      version: updated!.hash,
    });

    expect(byHash).toMatchObject({ hash: updated!.hash, priceCents: 63_000 });
    expect(clientNode.transport.snapshot()).toMatchObject({
      role: 'client',
      hubAddress: first.address,
      connectedToHub: true,
    });
  });
});

describe('HubTransport transitions', () => {
  it('releases the port and the socket on hub, client, standalone', async () => {
    const other = await hub();
    const { store, transport } = await hub();
    const port = transport.boundPort()!;
    expect(await probe(port)).toBe('open');

    await transport.becomeClient(other.address);
    await until(() => store.readsThroughNetwork);
    expect(await probe(port)).toBe('refused');
    expect(store.localIo.isOpen).toBe(true);
    await until(
      () =>
        (other.transport.snapshot() as { connectedClients: number })
          .connectedClients === 1,
    );

    await transport.becomeStandalone();
    await until(
      () =>
        (other.transport.snapshot() as { connectedClients: number })
          .connectedClients === 0,
    );

    expect(transport.snapshot()).toStrictEqual({
      role: 'standalone',
      hubAddress: null,
      lastError: null,
    });
    expect(store.readsThroughNetwork).toBe(false);
    expect(store.localIo.isOpen).toBe(true);
    expect((await store.listAnimals()).total).toBe(10);
  });

  it('ends in the state of the last call when transitions overlap', async () => {
    const other = await hub();
    const { transport } = await hub();

    const first = transport.becomeClient(other.address);
    const second = transport.becomeHub('127.0.0.1:0');
    const third = transport.becomeStandalone();
    await Promise.all([first, second, third]);

    expect(transport.snapshot().role).toBe('standalone');
  });
});
