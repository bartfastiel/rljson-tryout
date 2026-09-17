import { afterEach, describe, expect, it } from 'vitest';

import type { PetShopStore } from '../store/petShopStore.ts';
import {
  buildTestSyncAgent,
  buildTestTransport,
} from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';
import type { HubTransport } from './hubTransport.ts';
import type { SyncAgent } from './syncAgent.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

type Node = {
  nodeId: string;
  store: PetShopStore;
  transport: HubTransport;
  agent: SyncAgent;
};

/**
 * A node as `main.ts` wires it, in this process: a seeded store, the hub
 * transport over it and the sync agent listening to both, with the agent
 * started before the seed so that the seed's change sets queue up.
 */
const node = async (nodeId: string): Promise<Node> => {
  const store = await memoryStore();
  cleanups.push(() => store.close());
  const transport = buildTestTransport(store);
  cleanups.push(() => transport.stop());
  const agent = buildTestSyncAgent(store, transport);
  cleanups.push(() => agent.stop());
  await store.seedIfEmpty();
  return { nodeId, store, transport, agent };
};

const until = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const connectedClients = (hub: Node): number =>
  (hub.transport.snapshot() as { connectedClients: number }).connectedClients;

/** A hub and two clients connected to it, every transport connected. */
const network = async () => {
  const hub = await node('hub-node');
  await hub.transport.becomeHub('127.0.0.1:0', {
    selfNodeId: hub.nodeId,
    hubNodeId: hub.nodeId,
  });
  const address = `127.0.0.1:${hub.transport.boundPort()}`;
  const clients: Node[] = [];
  for (const name of ['client-a', 'client-b']) {
    const client = await node(name);
    await client.transport.becomeClient(address, {
      selfNodeId: client.nodeId,
      hubNodeId: hub.nodeId,
    });
    clients.push(client);
  }
  await until(
    () =>
      connectedClients(hub) === 2 &&
      clients.every((client) => client.store.readsThroughNetwork),
  );
  return { hub, clients, all: [hub, ...clients] };
};

describe('SyncAgent over the hub transport', () => {
  it('announces the seed on connect and every other node skips it by hash', async () => {
    const { hub, clients, all } = await network();

    await until(() =>
      all.every(
        (member) =>
          member.agent.snapshot().announced === 44 &&
          member.agent.snapshot().pending === 0,
      ),
    );

    // The hub announced before any client connected and repeats for each
    // join; each client announced on connect. Nothing was pulled: every
    // node holds the same seed. The hub hears every hash once, since its
    // connector drops a reference it received before (the second client's
    // announcements repeat the first client's); each client hears the
    // hub's repeats and the other client's announcements.
    await until(() =>
      clients.every((client) => client.agent.snapshot().skipped >= 44),
    );
    await until(() => hub.agent.snapshot().skipped === 44);
    for (const member of all) {
      expect(member.agent.snapshot()).toMatchObject({
        received: 0,
        failed: 0,
        lastError: null,
      });
      expect(await member.store.tableRowCounts()).toMatchObject({
        changeSets: 44,
        changeSetsInsertHistory: 44,
      });
    }
  });

  it('brings an invoice issued on a client to the hub and the other client', async () => {
    const { hub, clients } = await network();
    const [issuer, other] = clients;
    await until(() => other!.agent.snapshot().skipped >= 44);

    const issued = await issuer!.store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });

    for (const receiver of [hub, other!]) {
      await until(async () =>
        (await receiver.store.listInvoices()).some(
          (invoice) => invoice.id === issued.id,
        ),
      );
      await until(() => receiver.agent.snapshot().received === 1);
      expect(await receiver.store.getInvoice(issued.id)).toStrictEqual(issued);
      expect(await receiver.store.holdsChangeSet(issued.changeSetHash!)).toBe(
        true,
      );
      const transfer = receiver.agent.snapshot().transfers[0];
      expect(transfer).toMatchObject({
        direction: 'incoming',
        peerNodeId: issuer!.nodeId,
        changeSetHash: issued.changeSetHash,
        changeSetId: 'issue-invoice-2026-0007',
        tables: {
          invoices: 1,
          invoicesInsertHistory: 1,
          invoiceItems: 1,
          invoiceItemsInsertHistory: 1,
        },
        status: 'completed',
      });
      expect(receiver.agent.snapshot().received).toBe(1);
    }
    expect(issuer!.agent.snapshot().transfers[0]).toMatchObject({
      direction: 'outgoing',
      peerNodeId: hub.nodeId,
      changeSetHash: issued.changeSetHash,
      status: 'completed',
    });
  });

  it('brings an animal renamed on the hub to both clients as the current version', async () => {
    const { hub, clients } = await network();
    const before = (await hub.store.getAnimal('bowser-the-guard-dog'))!;

    const renamed = (await hub.store.updateAnimal('bowser-the-guard-dog', {
      name: 'Bowser the Retired Guard Dog',
    }))!;

    for (const client of clients) {
      await until(
        async () =>
          (await client.store.getAnimal('bowser-the-guard-dog'))?.hash ===
          renamed.hash,
      );
      await until(() => client.agent.snapshot().received === 1);
      const history = (await client.store.getAnimalHistory(
        'bowser-the-guard-dog',
      ))!;
      expect(history.map((version) => version.hash)).toStrictEqual([
        renamed.hash,
        before.hash,
      ]);
      expect(history[0]).toMatchObject({
        current: true,
        previous: [history[1]!.timeId],
        name: 'Bowser the Retired Guard Dog',
      });
      expect(history[1]!.current).toBe(false);
      expect(
        (await client.store.listAnimals()).items.find(
          (animal) => animal.id === 'bowser-the-guard-dog',
        )?.name,
      ).toBe('Bowser the Retired Guard Dog');
      expect(client.agent.snapshot().transfers[0]).toMatchObject({
        direction: 'incoming',
        peerNodeId: hub.nodeId,
        status: 'completed',
      });
    }
    expect(hub.agent.snapshot().transfers[0]).toMatchObject({
      direction: 'outgoing',
      peerNodeId: null,
    });
  });

  it('repeats the announcements of the hub for a client that joins later and writes each once', async () => {
    const { hub, clients } = await network();
    const issued = await hub.store.issueInvoice({
      customerId: 'donald-duck',
      items: [{ animalId: 'quackmore-junior', quantity: 1 }],
    });
    for (const client of clients) {
      await until(async () =>
        client.store.holdsChangeSet(issued.changeSetHash!),
      );
    }
    const countsBefore = await Promise.all(
      clients.map((client) => client.store.tableRowCounts()),
    );

    // The hub repeats every announcement of its session on every join
    // (the seed and the invoice), to every client: the late one pulls the
    // invoice, the others hear the repeat and leave their stores as they
    // are.
    const late = await node('client-c');
    cleanups.push(() => late.transport.stop());
    await late.transport.becomeClient(
      `127.0.0.1:${hub.transport.boundPort()}`,
      { selfNodeId: late.nodeId, hubNodeId: hub.nodeId },
    );
    await until(async () => late.store.holdsChangeSet(issued.changeSetHash!));
    await until(() => late.agent.snapshot().skipped >= 44);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await late.store.getInvoice(issued.id)).toStrictEqual(issued);
    expect(late.agent.snapshot()).toMatchObject({ received: 1, failed: 0 });
    for (const [index, client] of clients.entries()) {
      expect(await client.store.tableRowCounts()).toStrictEqual(
        countsBefore[index],
      );
      expect(client.agent.snapshot()).toMatchObject({ received: 1, failed: 0 });
      expect(
        (await client.store.listInvoices()).filter(
          (invoice) => invoice.id === issued.id,
        ),
      ).toHaveLength(1);
    }
  });
});
