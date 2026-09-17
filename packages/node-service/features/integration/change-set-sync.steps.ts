import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import { composeNodes, ComposeProject } from './composeProject.ts';
import {
  allConnected,
  fetchStatus,
  nodeOf,
  waitForStatuses,
  type ComposeNode,
} from './statuses.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'change-set-sync.feature'),
);

const convergenceTimeoutMs = 90_000;

type InvoiceDetailResponse = {
  id: string;
  hash: string;
  items: { animal: { id: string } | null; quantity: number }[];
  changeSetHash: string | null;
};

type AnimalDetailResponse = { id: string; hash: string; name: string };

type AnimalVersionResponse = {
  hash: string;
  timeId: string;
  previous: string[];
  current: boolean;
};

const request = async <Body>(
  node: ComposeNode,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Body }> => {
  const response = await fetch(`http://127.0.0.1:${node.port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: (await response.json()) as Body };
};

/**
 * Polls until the condition holds and returns how long that took, which
 * is the announce-to-visible latency the findings record.
 */
const until = async (
  condition: () => Promise<boolean>,
  timeoutMs: number,
): Promise<number> => {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return Date.now() - started;
};

const byName = (name: string): ComposeNode => {
  const node = composeNodes.find((candidate) => candidate.name === name);
  if (node === undefined) {
    throw new Error(`no compose node is named ${name}`);
  }
  return node;
};

const listsInvoice = async (
  node: ComposeNode,
  invoiceId: string,
): Promise<boolean> =>
  (await request<{ id: string }[]>(node, '/api/invoices')).body.some(
    (invoice) => invoice.id === invoiceId,
  );

const listedAnimalName = async (
  node: ComposeNode,
  animalId: string,
): Promise<string | undefined> =>
  (
    await request<{ items: { id: string; name: string }[] }>(
      node,
      '/api/animals?limit=200',
    )
  ).body.items.find((animal) => animal.id === animalId)?.name;

/**
 * The same feature as `features/steps/change-set-sync.steps.ts`, against
 * the three containers of `deploy/compose/three-nodes.yml`: discovery
 * elects the hub, so node3 and node2 are whatever role the election gave
 * them, which is the point: a change set travels the same way from a
 * client and from the hub. The scenarios log the announce-to-visible
 * latency they measured. One compose run serves all three scenarios; the
 * third one restarts a client container.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeAllScenarios, AfterAllScenarios }) => {
    const project = new ComposeProject();
    let statuses: StatusReport[] = [];

    BeforeAllScenarios(async () => {
      await project.up();
    });

    AfterAllScenarios(async () => {
      const logFile = await project.saveLogs();
      console.log(`compose logs saved to ${logFile}`);
      await project.down();
    });

    const connectedNodes = async (): Promise<void> => {
      statuses = await waitForStatuses(allConnected, convergenceTimeoutMs);
      console.log(
        `roles: ${statuses.map((status) => `${status.nodeName} ${status.role}`).join(', ')}`,
      );
    };

    const nodeIdOf = (name: string): string =>
      statuses.find((status) => status.nodeName === name)!.nodeId!;

    const hubNode = (): ComposeNode =>
      nodeOf(statuses.find((status) => status.role === 'hub')!);

    const clientNodes = (): ComposeNode[] =>
      statuses
        .filter((status) => status.role === 'client')
        .map((status) => nodeOf(status));

    const buy = async (
      node: ComposeNode,
      animalId: string,
    ): Promise<InvoiceDetailResponse> => {
      const response = await request<InvoiceDetailResponse>(
        node,
        '/api/invoices',
        {
          method: 'POST',
          body: JSON.stringify({
            customerId: 'scrooge-mcduck',
            items: [{ animalId, quantity: 1 }],
          }),
        },
      );
      expect(response.status).toBe(201);
      return response.body;
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
          issued = await buy(byName('node3'), 'donald-the-third');
        });

        Then(
          'node1 and node2 list that invoice within five seconds',
          async () => {
            for (const name of ['node1', 'node2']) {
              const latency = await until(
                () => listsInvoice(byName(name), issued.id),
                5_000,
              );
              console.log(
                `invoice from node3 listed on ${name} after ${latency} ms`,
              );
            }
          },
        );

        And(
          'node1 and node2 serve that invoice by its id with its item and its change set hash',
          async () => {
            for (const name of ['node1', 'node2']) {
              const response = await request<InvoiceDetailResponse>(
                byName(name),
                `/api/invoices/${issued.id}`,
              );
              expect(response.status).toBe(200);
              expect(response.body).toStrictEqual(issued);
              expect(response.body.items[0]?.animal?.id).toBe(
                'donald-the-third',
              );
              expect(response.body.changeSetHash).toBe(issued.changeSetHash);
            }
          },
        );

        And(
          'the status of node1 and node2 counts one change set received from node3',
          async () => {
            for (const name of ['node1', 'node2']) {
              const sync = (await fetchStatus(byName(name).port)).sync;
              expect(sync).toMatchObject({ pending: 0, failed: 0 });
              expect(sync.received).toBeGreaterThanOrEqual(1);
              const transfer = sync.transfers.find(
                (candidate) => candidate.changeSetHash === issued.changeSetHash,
              );
              expect(transfer).toMatchObject({
                direction: 'incoming',
                peerNodeId: nodeIdOf('node3'),
                changeSetId: 'issue-invoice-2026-0007',
                tables: {
                  invoices: 1,
                  invoicesInsertHistory: 1,
                  invoiceItems: 1,
                  invoiceItemsInsertHistory: 1,
                },
                status: 'completed',
              });
              console.log(
                `${name} pulled the invoice change set in ${transfer!.durationMs} ms`,
              );
            }
          },
        );
      },
    );

    Scenario(
      'An animal renamed on node2 shows the new name on node1 and node3 within five seconds',
      ({ Given, When, Then, And }) => {
        let renamed: AnimalDetailResponse;
        let seedHash = '';

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
            seedHash = (
              await request<AnimalDetailResponse>(
                byName('node1'),
                '/api/animals/bowser-the-guard-dog',
              )
            ).body.hash;
          },
        );

        When(
          '"bowser-the-guard-dog" is renamed to "Bowser the Retired Guard Dog" on node2',
          async () => {
            const response = await request<AnimalDetailResponse>(
              byName('node2'),
              '/api/animals/bowser-the-guard-dog',
              {
                method: 'PUT',
                body: JSON.stringify({ name: 'Bowser the Retired Guard Dog' }),
              },
            );
            expect(response.status).toBe(200);
            renamed = response.body;
          },
        );

        Then(
          'node1 and node3 list "bowser-the-guard-dog" as "Bowser the Retired Guard Dog" within five seconds',
          async () => {
            for (const name of ['node1', 'node3']) {
              const latency = await until(
                async () =>
                  (await listedAnimalName(
                    byName(name),
                    'bowser-the-guard-dog',
                  )) === 'Bowser the Retired Guard Dog',
                5_000,
              );
              console.log(
                `rename from node2 listed on ${name} after ${latency} ms`,
              );
            }
          },
        );

        And(
          'node1 and node3 show the renamed version as current, chained to the seed version',
          async () => {
            for (const name of ['node1', 'node3']) {
              const detail = await request<AnimalDetailResponse>(
                byName(name),
                '/api/animals/bowser-the-guard-dog',
              );
              expect(detail.body).toMatchObject({
                hash: renamed.hash,
                name: 'Bowser the Retired Guard Dog',
              });
              const history = (
                await request<AnimalVersionResponse[]>(
                  byName(name),
                  '/api/animals/bowser-the-guard-dog/history',
                )
              ).body;
              expect(history).toHaveLength(2);
              expect(history[0]).toMatchObject({
                hash: renamed.hash,
                current: true,
                previous: [history[1]!.timeId],
              });
              expect(history[1]).toMatchObject({
                hash: seedHash,
                current: false,
                previous: [],
              });
              expect(history[1]!.timeId).toMatch(/:seed$/);
            }
          },
        );
      },
    );

    Scenario(
      'A change set announced again is written once',
      ({ Given, When, Then, And }) => {
        let issued: InvoiceDetailResponse;
        let restarted: ComposeNode;
        let other: ComposeNode;
        let otherTablesBefore: Record<string, number>;
        let otherReceivedBefore = 0;

        Given(
          'three nodes of one domain connected through their hub',
          async () => {
            await connectedNodes();
            [restarted, other] = clientNodes() as [ComposeNode, ComposeNode];
          },
        );

        And(
          'Scrooge McDuck bought "donald-the-third" on the hub and every client holds that change set',
          async () => {
            issued = await buy(hubNode(), 'donald-the-third');
            for (const client of [restarted, other]) {
              await until(() => listsInvoice(client, issued.id), 5_000);
            }
            const report = await fetchStatus(other.port);
            otherTablesBefore = report.tables;
            otherReceivedBefore = report.sync.received;
          },
        );

        When('a client restarts and joins the hub again', async () => {
          console.log(`restarting ${restarted.name}`);
          await project.restart(restarted.name);
          await until(async () => {
            try {
              const report = await fetchStatus(restarted.port);
              return (
                report.transport.role === 'client' &&
                report.transport.connectedToHub
              );
            } catch {
              return false;
            }
          }, convergenceTimeoutMs);
        });

        Then(
          'the restarted client holds that change set within ten seconds',
          async () => {
            const latency = await until(
              () => listsInvoice(restarted, issued.id),
              10_000,
            );
            console.log(
              `${restarted.name} held the hub's invoice again ${latency} ms after it rejoined`,
            );
            const response = await request<InvoiceDetailResponse>(
              restarted,
              `/api/invoices/${issued.id}`,
            );
            expect(response.body).toStrictEqual(issued);
            expect((await fetchStatus(restarted.port)).sync.failed).toBe(0);
          },
        );

        And(
          'the other client still lists that invoice once and holds that change set once',
          async () => {
            await new Promise((resolvePromise) =>
              setTimeout(resolvePromise, 2_000),
            );
            const invoices = (
              await request<{ id: string }[]>(other, '/api/invoices')
            ).body;
            expect(
              invoices.filter((invoice) => invoice.id === issued.id),
            ).toHaveLength(1);
            const report = await fetchStatus(other.port);
            expect(report.tables).toStrictEqual(otherTablesBefore);
            expect(report.sync.received).toBe(otherReceivedBefore);
            expect(report.sync.failed).toBe(0);
          },
        );
      },
    );
  },
);
