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
 * A node as `main.ts` wires it, in this process: a store seeded `small`
 * unless told otherwise, the hub transport over it and the sync agent
 * listening to both, with the agent started before the seed as in
 * `main.ts`.
 */
const node = async (
  nodeId: string,
  options: { seed?: boolean; hubPort?: number } = {},
): Promise<Node> => {
  const store = await memoryStore();
  cleanups.push(() => store.close());
  const transport = buildTestTransport(store, {
    hubPort: options.hubPort ?? 0,
  });
  cleanups.push(() => transport.stop());
  const agent = buildTestSyncAgent(store, transport);
  cleanups.push(() => agent.stop());
  if (options.seed ?? true) {
    await store.seedIfEmpty();
  }
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

const connectedToHub = (client: Node): boolean =>
  (client.transport.snapshot() as { connectedToHub?: boolean })
    .connectedToHub === true;

const caughtUp = (member: Node): boolean =>
  member.agent.snapshot().catchUp.lastCompletedAt !== null &&
  member.agent.snapshot().pending === 0;

const join = async (client: Node, hub: Node): Promise<void> => {
  await client.transport.becomeClient(
    `127.0.0.1:${hub.transport.boundPort()}`,
    { selfNodeId: client.nodeId, hubNodeId: hub.nodeId },
  );
};

/** A hub and two clients connected to it, every transport connected. */
const network = async () => {
  const hub = await node('hub-node');
  await hub.transport.becomeHub('127.0.0.1:0', {
    selfNodeId: hub.nodeId,
    hubNodeId: hub.nodeId,
  });
  const clients: Node[] = [];
  for (const name of ['client-a', 'client-b']) {
    const client = await node(name);
    await join(client, hub);
    clients.push(client);
  }
  await until(
    () =>
      connectedClients(hub) === 2 &&
      clients.every((client) => client.store.readsThroughNetwork),
  );
  return { hub, clients, all: [hub, ...clients] };
};

/**
 * Three seeded stores over real sockets take about 1.5 s on a development
 * machine and have run into Vitest's default of 5 s on a busy CI runner,
 * so each scenario gets three times the time.
 */
describe('SyncAgent over the hub transport', { timeout: 15_000 }, () => {
  it('finds nothing to transfer between nodes that seeded the same and announces nothing', async () => {
    const { all } = await network();

    await until(() => all.every(caughtUp));

    // Every catch-up compared the lists and found them equal: nothing was
    // announced, pulled or skipped on any side, and each node's catch-up
    // completed with nothing missing.
    for (const member of all) {
      expect(member.agent.snapshot()).toMatchObject({
        announced: 0,
        received: 0,
        skipped: 0,
        failed: 0,
        lastError: null,
        catchUp: { missingAtStart: 0, pulled: 0 },
      });
      expect(member.agent.snapshot().catchUp.durationMs).toBeLessThan(1_000);
      expect(await member.store.tableRowCounts()).toMatchObject({
        changeSets: 44,
        changeSetsInsertHistory: 44,
      });
    }
  });

  it('brings an invoice issued on a client to the hub and the other client', async () => {
    const { hub, clients, all } = await network();
    const [issuer, other] = clients;
    await until(() => all.every(caughtUp));

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

  it('brings a species image uploaded on a client to the hub and the other client, blob included', async () => {
    const { hub, clients, all } = await network();
    const [uploader, other] = clients as [Node, Node];
    await until(() => all.every(caughtUp));
    const photo = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`a photo taken on ${uploader.nodeId} at ${Date.now()}`),
    ]);

    const version = (await uploader.store.updateSpeciesImage(
      'duck',
      photo,
      'image/jpeg',
    ))!;

    for (const receiver of [hub, other]) {
      await until(() => receiver.agent.snapshot().received === 1);
      expect(
        (await receiver.store.listSpecies()).find((row) => row.id === 'duck'),
      ).toStrictEqual(version);
      expect(await receiver.store.hasLocalBlob(version.imageBlobId)).toBe(true);
      expect(await receiver.store.speciesImage(version._hash)).toStrictEqual({
        outcome: 'found',
        image: { content: photo, mimeType: 'image/jpeg' },
      });
      expect(receiver.agent.snapshot().transfers[0]).toMatchObject({
        direction: 'incoming',
        peerNodeId: uploader.nodeId,
        changeSetId: expect.stringMatching(
          /^update-species-image-duck-/,
        ) as string,
        tables: { species: 1, speciesInsertHistory: 1 },
        blobs: [{ blobId: version.imageBlobId, bytes: photo.length }],
        status: 'completed',
      });
    }
  });

  it('serves an uploaded image on demand when the blob arrives after the change set', async () => {
    const { hub, clients, all } = await network();
    const [uploader, other] = clients as [Node, Node];
    await until(() => all.every(caughtUp));
    const photo = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`a late photo ${Date.now()}`),
    ]);
    // The version is written on the uploader without its blob, the way a
    // node that pulled the rows but not the blob holds it; the blob is
    // stored on the uploader only once the others hold the version.
    const { blobId } = await uploader.store.blobs.setBlob(photo);
    const version = (await uploader.store.updateSpeciesImage(
      'duck',
      photo,
      'image/jpeg',
    ))!;
    await uploader.store.blobs.deleteBlob(blobId);

    for (const receiver of [hub, other]) {
      await until(() => receiver.agent.snapshot().received === 1);
      expect(await receiver.store.hasLocalBlob(blobId)).toBe(false);
      expect(receiver.agent.snapshot().transfers[0]).not.toHaveProperty(
        'blobs',
      );
      expect(await receiver.store.speciesImage(version._hash)).toMatchObject({
        outcome: 'unavailable',
        blobId,
      });
    }

    await uploader.store.blobs.setBlob(photo);

    for (const receiver of [other, hub]) {
      expect(await receiver.store.speciesImage(version._hash)).toStrictEqual({
        outcome: 'found',
        image: { content: photo, mimeType: 'image/jpeg' },
      });
      expect(await receiver.store.hasLocalBlob(blobId)).toBe(true);
    }
  });

  it('never shows an invoice without its items while its change set arrives', async () => {
    const { hub, clients, all } = await network();
    await until(() => all.every(caughtUp));
    const [first, second] = clients as [Node, Node];

    const everyoneHolds = (changeSetHash: string) =>
      until(async () => {
        for (const member of all) {
          if (!(await member.store.holdsChangeSet(changeSetHash))) {
            return false;
          }
        }
        return true;
      });

    // Written on the hub, read at once on a client, which either still
    // lacks the change set (and reads it through the hub, which holds it
    // whole) or holds it whole itself; written on a client, read at once
    // on the hub and the other client, whose reads may pass through the
    // hub's cache of the other client's pull, so one item there. Every
    // node holds an invoice before the next one is issued, since invoice
    // numbers are only unique across nodes once all of them count the
    // same invoices (slice D9).
    for (let round = 0; round < 8; round += 1) {
      const onHub = await hub.store.issueInvoice({
        customerId: 'scrooge-mcduck',
        items: [
          { animalId: 'donald-the-third', quantity: 1 },
          { animalId: 'quackmore-junior', quantity: 2 },
        ],
      });
      const seenOnClient = await first.store.getInvoice(onHub.id);
      expect(seenOnClient?.items).toHaveLength(2);
      await everyoneHolds(onHub.changeSetHash!);
      const onClient = await second.store.issueInvoice({
        customerId: 'donald-duck',
        items: [{ animalId: 'donald-the-third', quantity: 1 }],
      });
      for (const reader of [hub, first]) {
        const seen = await reader.store.getInvoice(onClient.id);
        expect(seen?.items).toHaveLength(1);
      }
      await everyoneHolds(onClient.changeSetHash!);
    }
    for (const member of all) {
      expect(await member.store.listInvoices()).toHaveLength(6 + 16);
    }
  }, 30_000);

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

  it('catches a client that joins later up with what the hub holds, and writes each change set once', async () => {
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

    const late = await node('client-c');
    await join(late, hub);
    await until(async () => late.store.holdsChangeSet(issued.changeSetHash!));
    await until(() => caughtUp(late) && caughtUp(hub));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await late.store.getInvoice(issued.id)).toStrictEqual(issued);
    expect(late.agent.snapshot()).toMatchObject({
      received: 1,
      failed: 0,
      catchUp: { missingAtStart: 1, pulled: 1 },
    });
    expect(late.agent.snapshot().transfers[0]).toMatchObject({
      direction: 'incoming',
      peerNodeId: hub.nodeId,
      changeSetHash: issued.changeSetHash,
      status: 'completed',
    });
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

  it('fills a client that joins with an empty store from the hub, in the hub order', async () => {
    const { hub, all } = await network();
    await until(() => all.every(caughtUp));
    const renamed = (await hub.store.updateAnimal('bowser-the-guard-dog', {
      name: 'Bowser the Retired Guard Dog',
    }))!;
    const hubCounts = await hub.store.tableRowCounts();

    const empty = await node('client-empty', { seed: false });
    expect(await empty.store.tableRowCounts()).toMatchObject({ animals: 0 });
    await join(empty, hub);
    await until(() => caughtUp(empty), 15_000);

    expect(await empty.store.tableRowCounts()).toStrictEqual(hubCounts);
    expect(empty.agent.snapshot()).toMatchObject({
      received: 45,
      announced: 0,
      failed: 0,
      pending: 0,
      catchUp: { missingAtStart: 45, pulled: 45 },
    });
    expect((await empty.store.getAnimal('bowser-the-guard-dog'))?.hash).toBe(
      renamed.hash,
    );
    expect(
      (await empty.store.getAnimalHistory('bowser-the-guard-dog'))!.map(
        (version) => version.current,
      ),
    ).toStrictEqual([true, false]);
    expect(await empty.store.listInvoices()).toStrictEqual(
      await hub.store.listInvoices(),
    );
    expect(hub.agent.snapshot()).toMatchObject({ received: 0, failed: 0 });
  });

  it('lets a node that joins with a populated store fill the hub and the other clients', async () => {
    const { hub, all } = await network();
    await until(() => all.every(caughtUp));
    const alone = await node('client-alone');
    const issued = await alone.store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    expect(alone.agent.snapshot().announced).toBe(0);

    await join(alone, hub);

    for (const receiver of all) {
      await until(async () =>
        receiver.store.holdsChangeSet(issued.changeSetHash!),
      );
      expect(await receiver.store.getInvoice(issued.id)).toStrictEqual(issued);
      expect(receiver.agent.snapshot().transfers[0]).toMatchObject({
        direction: 'incoming',
        peerNodeId: alone.nodeId,
        changeSetHash: issued.changeSetHash,
        status: 'completed',
      });
    }
    expect(alone.agent.snapshot()).toMatchObject({
      announced: 1,
      received: 0,
      catchUp: { missingAtStart: 0 },
    });
    expect(alone.agent.snapshot().transfers[0]).toMatchObject({
      direction: 'outgoing',
      peerNodeId: hub.nodeId,
      changeSetHash: issued.changeSetHash,
    });
    // The hub heard the announcement and, in its own catch-up against the
    // new client, found the same change set; it was pulled once.
    await until(() => caughtUp(hub));
    expect(hub.agent.snapshot()).toMatchObject({ received: 1, failed: 0 });
  });

  it('lets a hub that restarts with an empty store learn what its clients hold, and the clients each other', async () => {
    const { hub, clients } = await network();
    const [first, second] = clients as [Node, Node];
    await until(() => [hub, first, second].every(caughtUp));
    const port = hub.transport.boundPort()!;
    await hub.transport.becomeStandalone();
    await until(() => !connectedToHub(first) && !connectedToHub(second));

    const renamed = (await first.store.updateAnimal('bowser-the-guard-dog', {
      name: 'Bowser the Returned Guard Dog',
    }))!;
    const issued = await second.store.issueInvoice({
      customerId: 'scrooge-mcduck',
      items: [{ animalId: 'donald-the-third', quantity: 1 }],
    });
    const returned = await node('hub-node', { hubPort: port });
    await returned.transport.becomeHub(`127.0.0.1:${port}`, {
      selfNodeId: returned.nodeId,
      hubNodeId: returned.nodeId,
    });
    await until(() => connectedClients(returned) === 2, 15_000);

    for (const member of [returned, first, second]) {
      await until(
        async () =>
          (await member.store.getAnimal('bowser-the-guard-dog'))?.hash ===
            renamed.hash && member.store.holdsChangeSet(issued.changeSetHash!),
        15_000,
      );
      expect(await member.store.getInvoice(issued.id)).toStrictEqual(issued);
    }
    await until(() => caughtUp(returned));
    // One catch-up per client: each brought what that client had written
    // while the hub was away, so the last one reports one of the two.
    expect(returned.agent.snapshot()).toMatchObject({
      received: 2,
      failed: 0,
      pending: 0,
    });
    expect(returned.agent.snapshot().catchUp.pulled).toBeGreaterThanOrEqual(1);
    // The current version shows as soon as the animal's rows landed; the
    // junction rows and the change set record of the same pull follow.
    const hubCounts = await returned.store.tableRowCounts();
    for (const client of [first, second]) {
      await until(
        async () =>
          JSON.stringify(await client.store.tableRowCounts()) ===
          JSON.stringify(hubCounts),
      );
      expect(await client.store.tableRowCounts()).toStrictEqual(hubCounts);
    }
  }, 30_000);
});
