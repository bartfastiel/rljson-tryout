import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import { ComposeProject } from './composeProject.ts';
import {
  allConnected,
  fetchAllStatuses,
  nodeOf,
  waitForStatuses,
  type ComposeNode,
} from './statuses.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'hub-transport.feature'),
);

const convergenceTimeoutMs = 90_000;

type AnimalDetailResponse = {
  id: string;
  hash: string;
  priceCents: number;
};

type InvoiceDetailResponse = {
  id: string;
  items: { animal: { id: string } | null; quantity: number }[];
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
 * The same feature as `features/steps/hub-transport.steps.ts`, against the
 * three containers of `deploy/compose/three-nodes.yml`: discovery elects
 * the hub, the hub transport connects the other two, and the requests go
 * over HTTP to whichever container became the hub and to one of its
 * clients. One compose run serves both scenarios.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeAllScenarios, AfterAllScenarios }) => {
    const project = new ComposeProject();
    let hub: ComposeNode;
    let client: ComposeNode;

    BeforeAllScenarios(async () => {
      await project.up();
    });

    AfterAllScenarios(async () => {
      const logFile = await project.saveLogs();
      console.log(`compose logs saved to ${logFile}`);
      await project.down();
    });

    const connectedNodes = async (): Promise<StatusReport[]> => {
      const statuses = await waitForStatuses(
        allConnected,
        convergenceTimeoutMs,
      );
      hub = nodeOf(statuses.find((status) => status.role === 'hub')!);
      client = nodeOf(statuses.find((status) => status.role === 'client')!);
      console.log(`hub is ${hub.name}, reading through ${client.name}`);
      return statuses;
    };

    Scenario(
      'A row written on the hub is readable by hash on a client',
      ({ Given, When, Then, And }) => {
        let oldPriceCents = 0;
        let newVersion: AnimalDetailResponse;

        Given('a hub node and a client node connected to it', async () => {
          await connectedNodes();
          const current = await request<AnimalDetailResponse>(
            client,
            '/api/animals/donald-the-third',
          );
          expect(current.status).toBe(200);
          oldPriceCents = current.body.priceCents;
        });

        When(
          'the price of "donald-the-third" is changed to 61000 cents on the hub',
          async () => {
            const response = await request<AnimalDetailResponse>(
              hub,
              '/api/animals/donald-the-third',
              { method: 'PUT', body: JSON.stringify({ priceCents: 61_000 }) },
            );
            expect(response.status).toBe(200);
            newVersion = response.body;
          },
        );

        Then(
          'the client serves that version of "donald-the-third" by its hash at 61000 cents',
          async () => {
            const response = await request<AnimalDetailResponse>(
              client,
              `/api/animals/donald-the-third?version=${newVersion.hash}`,
            );

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
              id: 'donald-the-third',
              hash: newVersion.hash,
              priceCents: 61_000,
            });
          },
        );

        And(
          'the client lists "donald-the-third" at 61000 cents once the change set arrived',
          async () => {
            expect(oldPriceCents).not.toBe(61_000);
            const deadline = Date.now() + 5_000;
            let current: AnimalDetailResponse;
            do {
              current = (
                await request<AnimalDetailResponse>(
                  client,
                  '/api/animals/donald-the-third',
                )
              ).body;
              if (current.hash === newVersion.hash) {
                break;
              }
              await new Promise((resolvePromise) =>
                setTimeout(resolvePromise, 100),
              );
            } while (Date.now() < deadline);

            expect(current).toMatchObject({
              hash: newVersion.hash,
              priceCents: 61_000,
            });
          },
        );
      },
    );

    Scenario(
      'An invoice issued on the hub is readable by id on a client',
      ({ Given, When, Then, And }) => {
        let issued: InvoiceDetailResponse;

        Given('a hub node and a client node connected to it', async () => {
          await connectedNodes();
        });

        When('Scrooge McDuck buys "donald-the-third" on the hub', async () => {
          const response = await request<InvoiceDetailResponse>(
            hub,
            '/api/invoices',
            {
              method: 'POST',
              body: JSON.stringify({
                customerId: 'scrooge-mcduck',
                items: [{ animalId: 'donald-the-third', quantity: 1 }],
              }),
            },
          );
          expect(response.status).toBe(201);
          issued = response.body;
        });

        Then(
          'the client serves that invoice by its id with one item',
          async () => {
            // The change set of the invoice is arriving on the client at
            // the same time: for the milliseconds between its invoice row
            // and its item rows landing, the invoice is current locally
            // without items, so the read is repeated until the item is
            // there, either through the cascade or from the change set.
            const deadline = Date.now() + 5_000;
            let response: { status: number; body: InvoiceDetailResponse };
            do {
              response = await request<InvoiceDetailResponse>(
                client,
                `/api/invoices/${issued.id}`,
              );
              if (response.status === 200 && response.body.items.length > 0) {
                break;
              }
              await new Promise((resolvePromise) =>
                setTimeout(resolvePromise, 100),
              );
            } while (Date.now() < deadline);

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(issued.id);
            expect(response.body.items).toStrictEqual(issued.items);
            expect(response.body.items[0]?.animal?.id).toBe('donald-the-third');
          },
        );

        And(
          'the status of the hub counts every client as connected',
          async () => {
            const statuses = await fetchAllStatuses();
            for (const status of statuses) {
              if (status.role === 'hub') {
                expect(status.transport).toMatchObject({
                  role: 'hub',
                  connectedClients: 2,
                  lastError: null,
                });
              } else {
                expect(status.transport).toMatchObject({
                  role: 'client',
                  hubAddress: status.hubAddress,
                  connectedToHub: true,
                  lastError: null,
                });
              }
              expect(
                status.nodes.find((node) => node.nodeId === status.hubNodeId)
                  ?.connectedClients,
              ).toBe(2);
            }
          },
        );
      },
    );
  },
);
