import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import { ComposeProject } from './composeProject.ts';
import {
  allConnected,
  fetchStatus,
  nodeNamed,
  nodeOf,
  statusOrNull,
  until,
  waitForStatuses,
  type ComposeNode,
} from './statuses.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'identity.feature'),
);

const convergenceTimeoutMs = 90_000;

/**
 * The broadcast timeout of `@rljson/network` (15 s) plus one check
 * interval (5 s): the latest moment a peer that stopped announcing leaves
 * the others' peer tables.
 */
const peerTimeoutMs = 20_000;

const nodeIdOf = async (node: ComposeNode): Promise<string> => {
  const status = await fetchStatus(node.port);
  expect(status.nodeId).not.toBeNull();
  return status.nodeId!;
};

const peerIdsOf = (status: StatusReport): string[] =>
  status.peers.map((peer) => peer.nodeId);

/**
 * The scenarios of `features/identity.feature` against the containers of
 * `deploy/compose/three-nodes.yml`: node1 and node2 run over SQLite on a
 * named volume each, node3 in memory without one. node1 and node2 start
 * first so that one of them is the hub and the other a client with a
 * persistent identity; node3 joins as a client. The scenarios run in the
 * order of the feature on the same project: the client restart first
 * (the hub stays), then the memory node's replacement (the hub stays),
 * then the hub's own quick restart, which is the split view the repair
 * heals. The scenario tagged `in-process` drives the repair with fakes
 * and runs in `pnpm test`.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeAllScenarios, AfterAllScenarios }) => {
    const project = new ComposeProject();

    BeforeAllScenarios(async () => {
      await project.up(['node1', 'node2']);
      await project.up(['node3']);
    });

    AfterAllScenarios(async () => {
      const logFile = await project.saveLogs();
      console.log(`compose logs saved to ${logFile}`);
      await project.down();
    });

    const connectedThroughOneHub = async (): Promise<StatusReport[]> => {
      const statuses = await waitForStatuses(
        allConnected,
        convergenceTimeoutMs,
      );
      console.log(
        `roles: ${statuses.map((status) => `${status.nodeName} ${status.role}`).join(', ')}`,
      );
      expect(statuses.find((status) => status.nodeName === 'node3')?.role).toBe(
        'client',
      );
      return statuses;
    };

    Scenario(
      'A sqlite node keeps its node id across a restart',
      ({ Given, And, When, Then }) => {
        let client: ComposeNode;
        let before: StatusReport;
        let hubNodeId: string;

        Given(
          'three nodes of one domain connected through their hub, node3 among the clients',
          async () => {
            const statuses = await connectedThroughOneHub();
            hubNodeId = statuses[0].hubNodeId!;
            before = statuses.find(
              (status) =>
                status.role === 'client' && status.nodeName !== 'node3',
            )!;
            client = nodeOf(before);
          },
        );

        And(
          'the sqlite client among node1 and node2 reports an id generated at its start',
          () => {
            expect(before.storage).toBe('sqlite');
            expect(before.identity).toMatchObject({
              persistent: false,
              identityPath: '/data/identity/petshop-compose/node-id',
            });
          },
        );

        When(
          'that sqlite client is restarted within the peer timeout',
          async () => {
            const downtimeMs = await project.restart(client.name);
            console.log(`${client.name} restarted in ${downtimeMs} ms`);
            expect(downtimeMs).toBeLessThan(peerTimeoutMs);
          },
        );

        Then(
          'it reports the same node id, now restored from its data directory, and a later start time',
          async () => {
            const after = await fetchStatus(client.port);
            expect(after.nodeId).toBe(before.nodeId);
            expect(after.identity).toMatchObject({
              persistent: true,
              identityPath: '/data/identity/petshop-compose/node-id',
            });
            expect(after.identity!.startedAt > before.identity!.startedAt).toBe(
              true,
            );
          },
        );

        And(
          'it is connected to the same hub again within thirty seconds',
          async () => {
            const latency = await until(async () => {
              const status = await statusOrNull(client);
              return (
                status?.hubNodeId === hubNodeId &&
                status.transport.role === 'client' &&
                status.transport.connectedToHub
              );
            }, 30_000);
            console.log(
              `${client.name} was connected to the hub again ${latency} ms after its restart`,
            );
            await waitForStatuses(allConnected, convergenceTimeoutMs);
          },
        );

        And(
          'the other nodes keep it out of their hub election within fifteen seconds',
          async () => {
            const others = ['node1', 'node2', 'node3']
              .filter((name) => name !== client.name)
              .map(nodeNamed);
            const latency = await until(async () => {
              const statuses = await Promise.all(
                others.map((node) => fetchStatus(node.port)),
              );
              return statuses.every(
                (status) =>
                  status.peers.find((peer) => peer.nodeId === before.nodeId)
                    ?.excludedFromElection === true,
              );
            }, 15_000);
            console.log(
              `the other nodes excluded ${client.name} from their election ${latency} ms after it was connected again`,
            );
            for (const other of others) {
              const peer = (await fetchStatus(other.port)).peers.find(
                (candidate) => candidate.nodeId === before.nodeId,
              );
              expect(peer?.startedAt).toBe(before.identity!.startedAt);
            }
          },
        );
      },
    );

    Scenario(
      'A memory node gets a fresh id and the old one disappears from the others within the peer timeout',
      ({ Given, When, Then, And }) => {
        const node3 = nodeNamed('node3');
        let previousNodeId: string;
        let recreatedAt = 0;

        Given(
          'three nodes of one domain connected through their hub, node3 among the clients',
          async () => {
            await connectedThroughOneHub();
            previousNodeId = await nodeIdOf(node3);
          },
        );

        When('node3 is recreated', async () => {
          recreatedAt = Date.now();
          await project.recreate('node3');
          console.log(
            `node3 was replaced and healthy ${Date.now() - recreatedAt} ms after the recreate started`,
          );
        });

        Then(
          'node3 reports a generated id that differs from its previous one',
          async () => {
            const status = await fetchStatus(node3.port);
            expect(status.nodeId).not.toBeNull();
            expect(status.nodeId).not.toBe(previousNodeId);
            expect(status.storage).toBe('memory');
            expect(status.identity).toMatchObject({ persistent: false });
          },
        );

        And(
          'the previous id disappears from the peers of node1 and node2 within twenty-five seconds',
          async () => {
            const survivors = [nodeNamed('node1'), nodeNamed('node2')];
            const listed = async (): Promise<boolean[]> => {
              const statuses = await Promise.all(
                survivors.map((node) => fetchStatus(node.port)),
              );
              return statuses.map((status) =>
                peerIdsOf(status).includes(previousNodeId),
              );
            };
            expect(await listed()).toStrictEqual([true, true]);
            await until(
              async () => (await listed()).every((still) => !still),
              25_000,
            );
            console.log(
              `the previous id of node3 left the survivors' peers ${Date.now() - recreatedAt} ms after the recreate started`,
            );
          },
        );

        And(
          'every node is connected through the same hub again within thirty seconds',
          async () => {
            const statuses = await waitForStatuses(allConnected, 30_000);
            const newNodeId = await nodeIdOf(node3);
            for (const status of statuses.filter(
              (candidate) => candidate.nodeName !== 'node3',
            )) {
              expect(peerIdsOf(status)).toContain(newNodeId);
              expect(peerIdsOf(status)).not.toContain(previousNodeId);
            }
          },
        );
      },
    );

    Scenario(
      'A hub restarted within two seconds is agreed upon again within one minute',
      ({ Given, When, Then, And }) => {
        let hub: ComposeNode;
        let hubNodeId: string;
        let restartedAt = 0;
        let agreed: StatusReport[] = [];

        Given(
          'three nodes of one domain connected through their hub, node3 among the clients',
          async () => {
            const statuses = await connectedThroughOneHub();
            const status = statuses.find(
              (candidate) => candidate.role === 'hub',
            )!;
            hub = nodeOf(status);
            hubNodeId = status.nodeId!;
          },
        );

        When('the hub is restarted within the peer timeout', async () => {
          restartedAt = Date.now();
          const downtimeMs = await project.restart(hub.name);
          console.log(`${hub.name} (the hub) restarted in ${downtimeMs} ms`);
          expect(downtimeMs).toBeLessThan(peerTimeoutMs);
        });

        Then(
          'all three nodes agree on one hub with the same hub address within one minute',
          async () => {
            agreed = await waitForStatuses(allConnected, 60_000);
            console.log(
              `all three nodes agreed on ${agreed[0].hubAddress} ${Date.now() - restartedAt} ms after the restart started: ${agreed.map((status) => `${status.nodeName} ${status.role}`).join(', ')}`,
            );
            for (const status of agreed) {
              expect(status.hubNodeId).toBe(agreed[0].hubNodeId);
              expect(status.hubAddress).toBe(agreed[0].hubAddress);
            }
          },
        );

        And(
          'exactly one node reports the role hub and its transport serves the two others',
          () => {
            const hubs = agreed.filter((status) => status.role === 'hub');
            expect(hubs).toHaveLength(1);
            expect(hubs[0].transport).toMatchObject({
              role: 'hub',
              connectedClients: 2,
            });
            for (const status of agreed.filter(
              (candidate) => candidate.role !== 'hub',
            )) {
              expect(status.transport).toMatchObject({
                role: 'client',
                connectedToHub: true,
              });
            }
          },
        );

        And(
          'the restarted node reports the same node id as before',
          async () => {
            const status = await fetchStatus(hub.port);
            expect(status.nodeId).toBe(hubNodeId);
            expect(status.identity).toMatchObject({ persistent: true });
          },
        );
      },
    );
  },
  { excludeTags: ['in-process'] },
);
