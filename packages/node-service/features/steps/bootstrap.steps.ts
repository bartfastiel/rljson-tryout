import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { describe, expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'bootstrap.feature'),
);

type NodeName = 'node1' | 'node2' | 'node3' | 'node4';

/** The hub of every scenario; node1 and node3 are its clients. */
const hubName: NodeName = 'node2';

const clientNames: readonly NodeName[] = ['node1', 'node3'];

/** The node ids the scenarios give their nodes, discovery being off. */
const nodeIdOf = (name: NodeName): string => `${name}-id`;

type InvoiceDetailResponse = {
  id: string;
  hash: string;
  changeSetHash: string | null;
};

type AnimalDetailResponse = { id: string; hash: string; name: string };

const dataDirectories = useTemporaryDataDirectories();

const status = async (world: World): Promise<StatusReport> =>
  (await world.server.inject({ method: 'GET', url: '/status' })).json();

const until = async (
  condition: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
};

const listsInvoice = async (world: World, id: string): Promise<boolean> =>
  (await world.server.inject({ method: 'GET', url: '/api/invoices' }))
    .json<{ id: string }[]>()
    .some((invoice) => invoice.id === id);

const listedAnimalName = async (
  world: World,
  id: string,
): Promise<string | undefined> =>
  (await world.server.inject({ method: 'GET', url: '/api/animals?limit=200' }))
    .json<{ items: AnimalDetailResponse[] }>()
    .items.find((animal) => animal.id === id)?.name;

/**
 * Nodes in this process, discovery disabled and the roles given by hand:
 * node2 serves as hub on an ephemeral port, node1 and node3 connect to
 * it, each with a seeded store of the same kind and the node ids of
 * `nodeIdOf`; a scenario stops a node by closing its world and starts it
 * again with a fresh one, which for the in-memory store is what a
 * container restart does. Every node talks to the outside through
 * `inject`, the way the Compose run of `features/integration` talks to
 * the containers over HTTP.
 */
describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    const worlds = new Map<NodeName, World>();
    let hubPort = 0;
    let issued: InvoiceDetailResponse;
    let renamed: AnimalDetailResponse;

    AfterEachScenario(async () => {
      for (const world of [...worlds.values()].reverse()) {
        await closeWorld(world);
      }
      worlds.clear();
    });

    const world = (name: NodeName): World => {
      const found = worlds.get(name);
      if (found === undefined) {
        throw new Error(`${name} is not running`);
      }
      return found;
    };

    const startNode = async (name: NodeName): Promise<World> => {
      const started = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
        nodeName: name,
        hubPort: name === hubName ? hubPort : 0,
      });
      worlds.set(name, started);
      await started.store.seedIfEmpty();
      return started;
    };

    const stopNode = async (name: NodeName): Promise<void> => {
      await closeWorld(world(name));
      worlds.delete(name);
    };

    const serveAsHub = async (): Promise<void> => {
      const hub = world(hubName);
      await hub.transport.becomeHub(`127.0.0.1:${hubPort}`, {
        selfNodeId: nodeIdOf(hubName),
        hubNodeId: nodeIdOf(hubName),
      });
      hubPort = hub.transport.boundPort()!;
    };

    const joinHub = async (name: NodeName): Promise<void> => {
      await world(name).transport.becomeClient(`127.0.0.1:${hubPort}`, {
        selfNodeId: nodeIdOf(name),
        hubNodeId: nodeIdOf(hubName),
      });
      await until(async () => {
        const transport = (await status(world(name))).transport;
        return transport.role === 'client' && transport.connectedToHub;
      });
    };

    const caughtUp = async (name: NodeName): Promise<boolean> => {
      const sync = (await status(world(name))).sync;
      return sync.catchUp.lastCompletedAt !== null && sync.pending === 0;
    };

    const connectedNodes = async (): Promise<void> => {
      await startNode(hubName);
      await serveAsHub();
      for (const name of clientNames) {
        await startNode(name);
        await joinHub(name);
      }
      await until(async () => {
        const transport = (await status(world(hubName))).transport;
        return transport.role === 'hub' && transport.connectedClients === 2;
      });
      for (const name of [hubName, ...clientNames]) {
        await until(() => caughtUp(name));
      }
    };

    const buy = async (on: NodeName): Promise<InvoiceDetailResponse> => {
      const response = await world(on).server.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId: 'scrooge-mcduck',
          items: [{ animalId: 'donald-the-third', quantity: 1 }],
        },
      });
      expect(response.statusCode).toBe(201);
      return response.json<InvoiceDetailResponse>();
    };

    const rename = async (on: NodeName): Promise<AnimalDetailResponse> => {
      const response = await world(on).server.inject({
        method: 'PUT',
        url: '/api/animals/bowser-the-guard-dog',
        payload: { name: 'Bowser the Rested Guard Dog' },
      });
      expect(response.statusCode).toBe(200);
      return response.json<AnimalDetailResponse>();
    };

    const holdsBoth = async (name: NodeName): Promise<boolean> =>
      (await listsInvoice(world(name), issued.id)) &&
      (await listedAnimalName(world(name), 'bowser-the-guard-dog')) ===
        renamed.name;

    const expectSameRows = async (names: readonly NodeName[]) => {
      const [first, ...rest] = names;
      const reference = (await status(world(first!))).tables;
      for (const name of rest) {
        expect((await status(world(name))).tables).toStrictEqual(reference);
      }
    };

    Scenario('node3 restarts and catches up', ({ Given, When, And, Then }) => {
      Given(
        'three nodes of one domain connected through their hub, node3 among the clients',
        async () => {
          await connectedNodes();
        },
      );

      When('node3 is stopped', async () => {
        await stopNode('node3');
      });

      And(
        '"bowser-the-guard-dog" is renamed to "Bowser the Rested Guard Dog" on node1',
        async () => {
          renamed = await rename('node1');
        },
      );

      And('Scrooge McDuck buys "donald-the-third" on node2', async () => {
        issued = await buy('node2');
        await until(() => listsInvoice(world('node1'), issued.id));
      });

      And('node3 starts again and joins the hub', async () => {
        await startNode('node3');
        expect(await listsInvoice(world('node3'), issued.id)).toBe(false);
        await joinHub('node3');
      });

      Then(
        'node3 lists that invoice and the new name within ten seconds',
        async () => {
          await until(() => holdsBoth('node3'), 10_000);
          const detail = await world('node3').server.inject({
            method: 'GET',
            url: `/api/invoices/${issued.id}`,
          });
          expect(detail.json<InvoiceDetailResponse>()).toMatchObject({
            id: issued.id,
            hash: issued.hash,
            changeSetHash: issued.changeSetHash,
          });
        },
      );

      And('node3 holds the same rows as node1 and node2', async () => {
        await until(() => caughtUp('node3'));
        await expectSameRows(['node3', 'node1', 'node2']);
      });

      And(
        'the status of node3 reports a completed catch-up that pulled both change sets',
        async () => {
          const { sync } = await status(world('node3'));
          expect(sync).toMatchObject({
            received: 2,
            failed: 0,
            pending: 0,
            catchUp: { missingAtStart: 2, pulled: 2 },
          });
          expect(sync.catchUp.lastStartedAt).not.toBeNull();
          expect(sync.catchUp.durationMs).toBeGreaterThanOrEqual(0);
          expect(
            sync.transfers.map((transfer) => transfer.changeSetHash),
          ).toContain(issued.changeSetHash);
          expect(
            sync.transfers.every(
              (transfer) => transfer.peerNodeId === nodeIdOf(hubName),
            ),
          ).toBe(true);
        },
      );
    });

    Scenario(
      'A hub restarts and learns what the clients hold',
      ({ Given, When, And, Then }) => {
        Given(
          'three nodes of one domain connected through their hub, node3 among the clients',
          async () => {
            await connectedNodes();
          },
        );

        When('the hub is stopped', async () => {
          await stopNode(hubName);
          for (const name of clientNames) {
            await until(async () => {
              const transport = (await status(world(name))).transport;
              return transport.role === 'client' && !transport.connectedToHub;
            });
          }
        });

        And(
          '"bowser-the-guard-dog" is renamed to "Bowser the Rested Guard Dog" on node1',
          async () => {
            renamed = await rename('node1');
          },
        );

        And('Scrooge McDuck buys "donald-the-third" on node3', async () => {
          issued = await buy('node3');
        });

        And('the hub starts again from the seed on the same port', async () => {
          await startNode(hubName);
          expect(await listsInvoice(world(hubName), issued.id)).toBe(false);
          await serveAsHub();
        });

        Then(
          'every node lists that invoice and the new name within ten seconds',
          async () => {
            for (const name of [hubName, ...clientNames]) {
              await until(() => holdsBoth(name), 10_000);
            }
          },
        );

        And('every node holds the same rows', async () => {
          for (const name of [hubName, ...clientNames]) {
            await until(() => caughtUp(name));
          }
          await expectSameRows([hubName, ...clientNames]);
          expect((await status(world(hubName))).sync).toMatchObject({
            received: 2,
            failed: 0,
          });
        });
      },
    );

    Scenario(
      'A node joining with a populated store announces what the hub lacks',
      ({ Given, And, When, Then }) => {
        Given(
          'three nodes of one domain connected through their hub, node3 among the clients',
          async () => {
            await connectedNodes();
          },
        );

        And(
          'a fourth node on its own, where Scrooge McDuck bought "donald-the-third"',
          async () => {
            await startNode('node4');
            issued = await buy('node4');
            expect((await status(world('node4'))).sync.announced).toBe(0);
          },
        );

        When('the fourth node joins the hub', async () => {
          await joinHub('node4');
        });

        Then('every node lists that invoice within five seconds', async () => {
          for (const name of [hubName, ...clientNames]) {
            await until(() => listsInvoice(world(name), issued.id));
          }
          await until(() => caughtUp('node4'));
          expect((await status(world('node4'))).sync).toMatchObject({
            announced: 1,
            received: 0,
            catchUp: { missingAtStart: 0, pulled: 0 },
          });
        });

        And(
          'the status of the hub counts that change set as received from the fourth node',
          async () => {
            const { sync } = await status(world(hubName));
            expect(sync).toMatchObject({ received: 1, failed: 0 });
            expect(
              sync.transfers.find(
                (transfer) => transfer.changeSetHash === issued.changeSetHash,
              ),
            ).toMatchObject({
              direction: 'incoming',
              peerNodeId: nodeIdOf('node4'),
              changeSetId: 'issue-invoice-2026-0007',
              status: 'completed',
            });
          },
        );
      },
    );
  });
});
