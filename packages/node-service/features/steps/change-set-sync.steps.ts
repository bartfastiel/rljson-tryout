import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { describe, expect } from 'vitest';

import type { SyncTransfer } from '../../src/network/syncAgent.ts';
import type { StatusReport } from '../../src/routes/status.ts';
import type { ChangeSetPayload } from '../../src/store/petShopStore.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'change-set-sync.feature'),
);

type NodeName = 'node1' | 'node2' | 'node3';

const nodeNames: readonly NodeName[] = ['node1', 'node2', 'node3'];

/** The node ids the scenarios give their nodes, discovery being off. */
const nodeIdOf = (name: NodeName): string => `${name}-id`;

type InvoiceDetailResponse = {
  id: string;
  hash: string;
  items: { animal: { id: string } | null; quantity: number }[];
  changeSetHash: string | null;
};

type InvoiceListEntry = { id: string };

type AnimalListEntry = { id: string; name: string };

type AnimalVersionResponse = {
  hash: string;
  timeId: string;
  previous: string[];
  current: boolean;
  name: string;
};

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

const listedInvoiceIds = async (world: World): Promise<string[]> =>
  (await world.server.inject({ method: 'GET', url: '/api/invoices' }))
    .json<InvoiceListEntry[]>()
    .map((invoice) => invoice.id);

const listedAnimalName = async (
  world: World,
  id: string,
): Promise<string | undefined> =>
  (await world.server.inject({ method: 'GET', url: '/api/animals?limit=200' }))
    .json<{ items: AnimalListEntry[] }>()
    .items.find((animal) => animal.id === id)?.name;

/**
 * Three nodes in this process, discovery disabled and the roles given by
 * hand: node1 serves as hub on an ephemeral port, node2 and node3 connect
 * to it, each with a seeded store of the same kind and the node ids of
 * `nodeIdOf`. Every node talks to the outside through `inject`, the way
 * the Compose run of `features/integration` talks to the containers over
 * HTTP.
 */
describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    const worlds = new Map<NodeName, World>();
    let hubAddress = '';

    AfterEachScenario(async () => {
      for (const name of [...nodeNames].reverse()) {
        const world = worlds.get(name);
        if (world !== undefined) {
          await closeWorld(world);
        }
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
      });
      worlds.set(name, started);
      await started.store.seedIfEmpty();
      return started;
    };

    const joinHub = async (name: NodeName): Promise<void> => {
      await world(name).transport.becomeClient(hubAddress, {
        selfNodeId: nodeIdOf(name),
        hubNodeId: nodeIdOf('node1'),
      });
      await until(async () => {
        const transport = (await status(world(name))).transport;
        return transport.role === 'client' && transport.connectedToHub;
      });
    };

    const connectedNodes = async (): Promise<void> => {
      const hub = await startNode('node1');
      await hub.transport.becomeHub('127.0.0.1:0', {
        selfNodeId: nodeIdOf('node1'),
        hubNodeId: nodeIdOf('node1'),
      });
      hubAddress = `127.0.0.1:${hub.transport.boundPort()}`;
      for (const name of ['node2', 'node3'] as const) {
        await startNode(name);
        await joinHub(name);
      }
      await until(async () => {
        const transport = (await status(hub)).transport;
        return transport.role === 'hub' && transport.connectedClients === 2;
      });
    };

    const buy = async (
      on: NodeName,
      animalId: string,
    ): Promise<InvoiceDetailResponse> => {
      const response = await world(on).server.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId: 'scrooge-mcduck',
          items: [{ animalId, quantity: 1 }],
        },
      });
      expect(response.statusCode).toBe(201);
      const issued = response.json<InvoiceDetailResponse>();
      expect(issued.changeSetHash).not.toBeNull();
      return issued;
    };

    Scenario(
      'An invoice issued on node3 appears on node1 and node2 within five seconds',
      ({ Given, When, Then, And }) => {
        let issued: InvoiceDetailResponse;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        When('Scrooge McDuck buys "donald-the-third" on node3', async () => {
          issued = await buy('node3', 'donald-the-third');
        });

        Then(
          'node1 and node2 list that invoice within five seconds',
          async () => {
            for (const name of ['node1', 'node2'] as const) {
              await until(async () =>
                (await listedInvoiceIds(world(name))).includes(issued.id),
              );
              await until(
                async () => (await status(world(name))).sync.received === 1,
              );
            }
          },
        );

        And(
          'node1 and node2 serve that invoice by its id with its item and its change set hash',
          async () => {
            for (const name of ['node1', 'node2'] as const) {
              const response = await world(name).server.inject({
                method: 'GET',
                url: `/api/invoices/${issued.id}`,
              });
              expect(response.statusCode).toBe(200);
              const invoice = response.json<InvoiceDetailResponse>();
              expect(invoice).toStrictEqual(issued);
              expect(invoice.items[0]?.animal?.id).toBe('donald-the-third');
              expect(invoice.changeSetHash).toBe(issued.changeSetHash);
            }
          },
        );

        And(
          'the status of node1 and node2 counts one change set received from node3',
          async () => {
            for (const name of ['node1', 'node2'] as const) {
              const sync = (await status(world(name))).sync;
              expect(sync).toMatchObject({
                received: 1,
                pending: 0,
                failed: 0,
                lastError: null,
              });
              expect(sync.transfers[0]).toMatchObject({
                direction: 'incoming',
                peerNodeId: nodeIdOf('node3'),
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
            }
            const sender = (await status(world('node3'))).sync;
            expect(sender.transfers[0]).toMatchObject({
              direction: 'outgoing',
              peerNodeId: nodeIdOf('node1'),
              changeSetHash: issued.changeSetHash,
            });
          },
        );
      },
    );

    Scenario(
      'An animal renamed on node2 shows the new name on node1 and node3 within five seconds',
      ({ Given, When, Then, And }) => {
        let renamedHash = '';
        let seedHash = '';

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
            const before = await world('node1').server.inject({
              method: 'GET',
              url: '/api/animals/bowser-the-guard-dog',
            });
            seedHash = before.json<{ hash: string }>().hash;
          },
        );

        When(
          '"bowser-the-guard-dog" is renamed to "Bowser the Retired Guard Dog" on node2',
          async () => {
            const response = await world('node2').server.inject({
              method: 'PUT',
              url: '/api/animals/bowser-the-guard-dog',
              payload: { name: 'Bowser the Retired Guard Dog' },
            });
            expect(response.statusCode).toBe(200);
            renamedHash = response.json<{ hash: string }>().hash;
          },
        );

        Then(
          'node1 and node3 list "bowser-the-guard-dog" as "Bowser the Retired Guard Dog" within five seconds',
          async () => {
            for (const name of ['node1', 'node3'] as const) {
              await until(
                async () =>
                  (await listedAnimalName(
                    world(name),
                    'bowser-the-guard-dog',
                  )) === 'Bowser the Retired Guard Dog',
              );
              await until(
                async () => (await status(world(name))).sync.received === 1,
              );
            }
          },
        );

        And(
          'node1 and node3 show the renamed version as current, chained to the seed version',
          async () => {
            for (const name of ['node1', 'node3'] as const) {
              const detail = await world(name).server.inject({
                method: 'GET',
                url: '/api/animals/bowser-the-guard-dog',
              });
              expect(
                detail.json<{ hash: string; name: string }>(),
              ).toMatchObject({
                hash: renamedHash,
                name: 'Bowser the Retired Guard Dog',
              });
              const history = (
                await world(name).server.inject({
                  method: 'GET',
                  url: '/api/animals/bowser-the-guard-dog/history',
                })
              ).json<AnimalVersionResponse[]>();
              expect(history).toHaveLength(2);
              expect(history[0]).toMatchObject({
                hash: renamedHash,
                current: true,
                previous: [history[1]!.timeId],
              });
              expect(history[1]).toMatchObject({
                hash: seedHash,
                current: false,
                previous: [],
              });
              expect(history[1]!.timeId).toMatch(/:seed$/);
              expect(
                (await status(world(name))).sync.transfers[0],
              ).toMatchObject({
                direction: 'incoming',
                peerNodeId: nodeIdOf('node2'),
                status: 'completed',
              });
            }
          },
        );
      },
    );

    Scenario(
      'The transfers with a node and the rows an edit carried are served to the web app',
      ({ Given, When, Then, And }) => {
        let renamedHash = '';
        let changeSetHash = '';

        const transfersWith = async (
          on: NodeName,
          peer: NodeName,
        ): Promise<SyncTransfer[]> =>
          (
            await world(on).server.inject({
              method: 'GET',
              url: `/api/sync/transfers?peer=${nodeIdOf(peer)}&limit=10`,
            })
          ).json<SyncTransfer[]>();

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        When(
          '"bowser-the-guard-dog" is renamed to "Bowser the Retired Guard Dog" on node2',
          async () => {
            const response = await world('node2').server.inject({
              method: 'PUT',
              url: '/api/animals/bowser-the-guard-dog',
              payload: { name: 'Bowser the Retired Guard Dog' },
            });
            expect(response.statusCode).toBe(200);
            renamedHash = response.json<{ hash: string }>().hash;
          },
        );

        Then(
          'node1 and node3 list that change set as their last transfer with node2 within five seconds',
          async () => {
            for (const name of ['node1', 'node3'] as const) {
              await until(
                async () =>
                  (await transfersWith(name, 'node2'))[0]?.status ===
                  'completed',
              );
              const [latest] = await transfersWith(name, 'node2');
              expect(latest).toMatchObject({
                direction: 'incoming',
                peerNodeId: nodeIdOf('node2'),
                changeSetId: expect.stringMatching(
                  /^update-animal-bowser-the-guard-dog-/,
                ) as string,
                tables: expect.objectContaining({
                  animals: 1,
                  animalsInsertHistory: 1,
                }) as Record<string, number>,
                status: 'completed',
              });
              changeSetHash = latest!.changeSetHash;
              expect(await transfersWith(name, 'node1')).toStrictEqual([]);
            }
          },
        );

        And('node2 lists it as its last transfer with the hub', async () => {
          expect((await transfersWith('node2', 'node1'))[0]).toMatchObject({
            direction: 'outgoing',
            peerNodeId: nodeIdOf('node1'),
            changeSetHash,
            status: 'completed',
          });
          expect(await transfersWith('node2', 'node3')).toStrictEqual([]);
        });

        And(
          "node1 serves that change set with the animal's name before and after",
          async () => {
            const response = await world('node1').server.inject({
              method: 'GET',
              url: `/api/change-sets/${changeSetHash}`,
            });
            expect(response.statusCode).toBe(200);
            const payload = response.json<ChangeSetPayload>();
            expect(payload.hash).toBe(changeSetHash);
            const animal = payload.items.find(
              (item) => item.table === 'animals',
            );
            expect(animal).toMatchObject({
              ref: renamedHash,
              row: { name: 'Bowser the Retired Guard Dog' },
              previousRow: { name: 'Bowser the Guard Dog' },
            });
            const history = payload.items.find(
              (item) => item.table === 'animalsInsertHistory',
            );
            expect(history).toMatchObject({
              row: { animalsRef: renamedHash },
              previousRow: null,
            });
            const missing = await world('node3').server.inject({
              method: 'GET',
              url: '/api/change-sets/NoSuchChangeSetHash00',
            });
            expect(missing.statusCode).toBe(404);
          },
        );
      },
    );

    Scenario(
      'A change set announced again is written once',
      ({ Given, When, Then, And }) => {
        let issued: InvoiceDetailResponse;
        const restarted: NodeName = 'node2';
        const other: NodeName = 'node3';
        let otherTablesBefore: Record<string, number>;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
          },
        );

        And(
          'Scrooge McDuck bought "donald-the-third" on the hub and every client holds that change set',
          async () => {
            issued = await buy('node1', 'donald-the-third');
            for (const name of [restarted, other]) {
              await until(async () =>
                world(name).store.holdsChangeSet(issued.changeSetHash!),
              );
            }
            otherTablesBefore = (await status(world(other))).tables;
          },
        );

        When('a client restarts and joins the hub again', async () => {
          await closeWorld(world(restarted));
          worlds.delete(restarted);
          await startNode(restarted);
          await joinHub(restarted);
        });

        Then(
          'the restarted client holds that change set within ten seconds',
          async () => {
            await until(
              async () =>
                world(restarted).store.holdsChangeSet(issued.changeSetHash!),
              10_000,
            );
            const response = await world(restarted).server.inject({
              method: 'GET',
              url: `/api/invoices/${issued.id}`,
            });
            expect(response.json<InvoiceDetailResponse>()).toStrictEqual(
              issued,
            );
            expect((await status(world(restarted))).sync).toMatchObject({
              received: 1,
              failed: 0,
            });
          },
        );

        And(
          'the other client still lists that invoice once and holds that change set once',
          async () => {
            await new Promise((resolvePromise) =>
              setTimeout(resolvePromise, 600),
            );
            expect(
              (await listedInvoiceIds(world(other))).filter(
                (id) => id === issued.id,
              ),
            ).toHaveLength(1);
            const report = await status(world(other));
            expect(report.tables).toStrictEqual(otherTablesBefore);
            expect(report.sync).toMatchObject({ received: 1, failed: 0 });
          },
        );
      },
    );
  });
});
