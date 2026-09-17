import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import { ComposeProject, composeNodes } from './composeProject.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'network.feature'),
);

const convergenceTimeoutMs = 90_000;
const pollIntervalMs = 500;

const fetchStatus = async (port: number): Promise<StatusReport> => {
  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`/status on port ${port} answered ${response.status}`);
  }
  return (await response.json()) as StatusReport;
};

const fetchAllStatuses = (): Promise<StatusReport[]> =>
  Promise.all(composeNodes.map((node) => fetchStatus(node.port)));

const hasSettled = (status: StatusReport): boolean =>
  (status.role === 'hub' || status.role === 'client') &&
  status.peers.length === composeNodes.length - 1 &&
  status.peers.every((peer) => peer.probe?.reachable === true);

/**
 * Every node knows every other node and all of them name the same hub. A
 * node that missed the earliest node's first announcement is a second hub
 * for one broadcast interval, so per-node settling alone is not enough.
 */
const allAgree = (statuses: StatusReport[]): boolean =>
  statuses.every(hasSettled) &&
  statuses.every(
    (status) =>
      status.hubNodeId !== null && status.hubNodeId === statuses[0].hubNodeId,
  );

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
  const project = new ComposeProject();
  let statuses: StatusReport[] = [];

  AfterEachScenario(async () => {
    const logFile = await project.saveLogs();
    console.log(`compose logs saved to ${logFile}`);
    await project.down();
  });

  Scenario(
    'Three nodes start, exactly one becomes hub',
    ({ Given, When, Then, And }) => {
      let startedAt = 0;
      let healthyAt = 0;

      Given(
        'the three nodes of the Docker Compose setup are started',
        async () => {
          startedAt = Date.now();
          await project.up();
          healthyAt = Date.now();
          console.log(
            `all three containers healthy ${healthyAt - startedAt} ms after compose up`,
          );
        },
      );

      When('every node reports the two others as reachable peers', async () => {
        const deadline = Date.now() + convergenceTimeoutMs;
        for (;;) {
          try {
            statuses = await fetchAllStatuses();
            if (allAgree(statuses)) {
              break;
            }
          } catch (error) {
            if (Date.now() >= deadline) {
              throw error;
            }
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `the nodes did not settle within ${convergenceTimeoutMs} ms: ${JSON.stringify(
                statuses.map((status) => ({
                  nodeName: status.nodeName,
                  role: status.role,
                  peers: status.peers.length,
                })),
              )}`,
            );
          }
          await sleep(pollIntervalMs);
        }
        const settledAt = Date.now();
        console.log(
          `topology settled ${settledAt - healthyAt} ms after the containers were healthy, ${settledAt - startedAt} ms after compose up`,
        );
      });

      Then(
        'exactly one node reports the role hub and the other two report client',
        () => {
          const roles = statuses.map((status) => status.role);
          expect(roles.filter((role) => role === 'hub')).toHaveLength(1);
          expect(roles.filter((role) => role === 'client')).toHaveLength(2);
        },
      );

      And('all three nodes agree on the hub address', () => {
        const hub = statuses.find((status) => status.role === 'hub');
        expect(hub).toBeDefined();
        expect(hub?.hubAddress).toMatch(/^\d+\.\d+\.\d+\.\d+:\d+$/u);
        for (const status of statuses) {
          expect(status.hubNodeId).toBe(hub?.nodeId);
          expect(status.hubAddress).toBe(hub?.hubAddress);
        }
      });

      And(
        'every node lists all three nodes of the environment as seen in the topology',
        () => {
          const expectedNames = composeNodes.map((node) => node.name);
          for (const status of statuses) {
            expect(status.nodes.map((node) => node.name)).toStrictEqual(
              expectedNames,
            );
            expect(
              status.nodes.map((node) => node.seenInTopology),
            ).toStrictEqual([true, true, true]);
            expect(status.nodes.map((node) => node.reachable)).toStrictEqual([
              true,
              true,
              true,
            ]);
            expect(status.nodes.filter((node) => node.self)).toHaveLength(1);
          }
        },
      );
    },
  );
});
