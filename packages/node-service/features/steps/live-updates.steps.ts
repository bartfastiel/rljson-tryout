import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { describe, expect } from 'vitest';

import type { InsertEvent } from '../../src/events/liveEvents.ts';
import type { SyncTransfer } from '../../src/network/syncAgent.ts';
import type { StatusReport } from '../../src/routes/status.ts';
import { EventStreamReader } from '../../src/testing/eventStreamReader.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'live-updates.feature'),
);

type InvoiceDetailResponse = {
  id: string;
  changeSetHash: string | null;
};

const dataDirectories = useTemporaryDataDirectories();

const status = async (world: World): Promise<StatusReport> =>
  (await world.server.inject({ method: 'GET', url: '/status' })).json();

const until = async (condition: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
};

/**
 * The event stream is the one endpoint `inject` cannot exercise (it
 * never ends), so the node under test listens on an ephemeral port and
 * a real HTTP client reads the stream, the way a browser tab does.
 */
const followStream = async (world: World): Promise<EventStreamReader> => {
  const address = await world.server.listen({ port: 0, host: '127.0.0.1' });
  const reader = await EventStreamReader.open(`${address}/api/events`);
  await reader.next((block) => block.comments.includes('connected'));
  return reader;
};

const buy = async (
  world: World,
  animalId: string,
): Promise<InvoiceDetailResponse> => {
  const response = await world.server.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: {
      customerId: 'scrooge-mcduck',
      items: [{ animalId, quantity: 1 }],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<InvoiceDetailResponse>();
};

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    const worlds: World[] = [];
    const readers: EventStreamReader[] = [];

    AfterEachScenario(async () => {
      for (const reader of readers.splice(0)) {
        reader.close();
      }
      for (const world of worlds.splice(0).reverse()) {
        await closeWorld(world);
      }
    });

    const startNode = async (nodeName: string): Promise<World> => {
      const world = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
        nodeName,
      });
      worlds.push(world);
      await world.store.seedIfEmpty();
      return world;
    };

    const follow = async (world: World): Promise<EventStreamReader> => {
      const reader = await followStream(world);
      readers.push(reader);
      return reader;
    };

    Scenario(
      'Issuing an invoice emits an insert event',
      ({ Given, When, Then }) => {
        let node: World;
        let stream: EventStreamReader;
        let issued: InvoiceDetailResponse;

        Given('a node whose event stream a client follows', async () => {
          node = await startNode('node-under-test');
          stream = await follow(node);
        });

        When(
          'Scrooge McDuck buys "donald-the-third" on that node',
          async () => {
            issued = await buy(node, 'donald-the-third');
          },
        );

        Then(
          "the stream carries an insert event naming the invoice's change set, its rows and its ids",
          async () => {
            const { id, payload } =
              await stream.nextEvent<InsertEvent>('insert');

            expect(id).toMatch(/^\d+$/);
            expect(payload).toStrictEqual({
              changeSetHash: issued.changeSetHash,
              changeSetId: 'issue-invoice-2026-0007',
              tables: {
                invoices: 1,
                invoicesInsertHistory: 1,
                invoiceItems: 1,
                invoiceItemsInsertHistory: 1,
              },
              entityIds: [issued.id, `${issued.id}-item-1`],
            });
          },
        );
      },
    );

    Scenario(
      'A synchronised change set emits a sync event',
      ({ Given, When, Then, And }) => {
        let hub: World;
        let client: World;
        let stream: EventStreamReader;
        let issued: InvoiceDetailResponse;

        Given('a hub node and a client node connected to it', async () => {
          hub = await startNode('hub-node');
          client = await startNode('client-node');
          await hub.transport.becomeHub('127.0.0.1:0', {
            selfNodeId: 'hub-node-id',
            hubNodeId: 'hub-node-id',
          });
          await client.transport.becomeClient(
            `127.0.0.1:${hub.transport.boundPort()}`,
            { selfNodeId: 'client-node-id', hubNodeId: 'hub-node-id' },
          );
          await until(async () => {
            const transport = (await status(client)).transport;
            return transport.role === 'client' && transport.connectedToHub;
          });
        });

        And(
          'a client follows the event stream of the client node',
          async () => {
            stream = await follow(client);
          },
        );

        When('Scrooge McDuck buys "donald-the-third" on the hub', async () => {
          issued = await buy(hub, 'donald-the-third');
        });

        Then(
          "the client node's stream carries a pending and then a completed sync event for that change set from the hub",
          async () => {
            const started = await stream.nextEvent<SyncTransfer>(
              'sync',
              (transfer) => transfer.changeSetHash === issued.changeSetHash,
            );
            expect(started.payload).toMatchObject({
              direction: 'incoming',
              peerNodeId: 'hub-node-id',
              changeSetId: null,
              tables: {},
              durationMs: 0,
              status: 'pending',
            });
            expect(started.payload.error).toBeUndefined();

            const completed = await stream.nextEvent<SyncTransfer>(
              'sync',
              (transfer) =>
                transfer.changeSetHash === issued.changeSetHash &&
                transfer.status === 'completed',
            );
            expect(completed.payload).toMatchObject({
              direction: 'incoming',
              peerNodeId: 'hub-node-id',
              changeSetId: 'issue-invoice-2026-0007',
              tables: {
                invoices: 1,
                invoicesInsertHistory: 1,
                invoiceItems: 1,
                invoiceItemsInsertHistory: 1,
              },
            });
            expect(Number(completed.id)).toBeGreaterThan(Number(started.id));
          },
        );

        And('the client node lists that invoice', async () => {
          const response = await client.server.inject({
            method: 'GET',
            url: '/api/invoices',
          });
          expect(
            response.json<{ id: string }[]>().map((invoice) => invoice.id),
          ).toContain(issued.id);
        });
      },
    );
  });
});
