import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';

import type { StatusReport } from '../../src/routes/status.ts';
import { composeNodes, ComposeProject } from './composeProject.ts';
import {
  allConnected,
  fetchStatus,
  waitForStatuses,
  type ComposeNode,
} from './statuses.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'bootstrap.feature'),
);

const convergenceTimeoutMs = 90_000;

type InvoiceDetailResponse = {
  id: string;
  hash: string;
  changeSetHash: string | null;
};

type AnimalDetailResponse = { id: string; hash: string; name: string };

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

/** Polls until the condition holds and returns how long that took. */
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
    await request<{ items: AnimalDetailResponse[] }>(
      node,
      '/api/animals?limit=200',
    )
  ).body.items.find((animal) => animal.id === animalId)?.name;

const statusOrNull = async (
  node: ComposeNode,
): Promise<StatusReport | null> => {
  try {
    return await fetchStatus(node.port);
  } catch {
    return null;
  }
};

/**
 * The restart scenario of `features/steps/bootstrap.steps.ts` against the
 * containers of `deploy/compose/three-nodes.yml`, node3 being the memory
 * node that restarts in production. node1 and node2 start first, so that
 * the election makes one of them hub and node3 joins as a client: a hub
 * that restarts within the broadcast timeout leaves the survivors
 * following a node that no longer serves them
 * (`docs/findings/network-discovery.md`), which is slice D6's problem,
 * not this scenario's. The scenarios tagged `in-process` need roles given
 * by hand and a fourth node and run in `pnpm test` only.
 */
describeFeature(
  feature,
  ({ Scenario, BeforeAllScenarios, AfterAllScenarios }) => {
    const project = new ComposeProject();
    let issued: InvoiceDetailResponse;
    let renamed: AnimalDetailResponse;

    BeforeAllScenarios(async () => {
      await project.up(['node1', 'node2']);
      await project.up(['node3']);
    });

    AfterAllScenarios(async () => {
      const logFile = await project.saveLogs();
      console.log(`compose logs saved to ${logFile}`);
      await project.down();
    });

    const node3 = byName('node3');

    const holdsBoth = async (node: ComposeNode): Promise<boolean> =>
      (await listsInvoice(node, issued.id)) &&
      (await listedAnimalName(node, 'bowser-the-guard-dog')) === renamed.name;

    Scenario('node3 restarts and catches up', ({ Given, When, And, Then }) => {
      let hubNodeId = '';

      Given(
        'three nodes of one domain connected through their hub, node3 among the clients',
        async () => {
          const statuses = await waitForStatuses(
            allConnected,
            convergenceTimeoutMs,
          );
          console.log(
            `roles: ${statuses.map((status) => `${status.nodeName} ${status.role}`).join(', ')}`,
          );
          const status3 = statuses.find(
            (status) => status.nodeName === 'node3',
          )!;
          expect(status3.role).toBe('client');
          hubNodeId = status3.hubNodeId!;
        },
      );

      When('node3 is stopped', async () => {
        await project.stop('node3');
      });

      And(
        '"bowser-the-guard-dog" is renamed to "Bowser the Rested Guard Dog" on node1',
        async () => {
          const response = await request<AnimalDetailResponse>(
            byName('node1'),
            '/api/animals/bowser-the-guard-dog',
            {
              method: 'PUT',
              body: JSON.stringify({ name: 'Bowser the Rested Guard Dog' }),
            },
          );
          expect(response.status).toBe(200);
          renamed = response.body;
        },
      );

      And('Scrooge McDuck buys "donald-the-third" on node2', async () => {
        const response = await request<InvoiceDetailResponse>(
          byName('node2'),
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
        await until(() => listsInvoice(byName('node1'), issued.id), 5_000);
      });

      And('node3 starts again and joins the hub', async () => {
        const started = Date.now();
        await project.start('node3');
        await until(async () => {
          const status = await statusOrNull(node3);
          return (
            status?.transport.role === 'client' &&
            status.transport.connectedToHub &&
            status.hubNodeId === hubNodeId
          );
        }, convergenceTimeoutMs);
        console.log(
          `node3 was connected to the hub again ${Date.now() - started} ms after the start`,
        );
      });

      Then(
        'node3 lists that invoice and the new name within ten seconds',
        async () => {
          const latency = await until(() => holdsBoth(node3), 10_000);
          console.log(
            `node3 held the invoice and the rename ${latency} ms after it rejoined`,
          );
          const detail = await request<InvoiceDetailResponse>(
            node3,
            `/api/invoices/${issued.id}`,
          );
          expect(detail.body).toMatchObject({
            id: issued.id,
            hash: issued.hash,
            changeSetHash: issued.changeSetHash,
          });
        },
      );

      And('node3 holds the same rows as node1 and node2', async () => {
        await until(async () => {
          const { sync } = await fetchStatus(node3.port);
          return sync.catchUp.lastCompletedAt !== null && sync.pending === 0;
        }, 10_000);
        const tables3 = (await fetchStatus(node3.port)).tables;
        for (const name of ['node1', 'node2']) {
          expect((await fetchStatus(byName(name).port)).tables).toStrictEqual(
            tables3,
          );
        }
      });

      And(
        'the status of node3 reports a completed catch-up that pulled both change sets',
        async () => {
          const { sync } = await fetchStatus(node3.port);
          expect(sync).toMatchObject({ failed: 0, pending: 0 });
          expect(sync.received).toBeGreaterThanOrEqual(2);
          expect(sync.catchUp.missingAtStart).toBeGreaterThanOrEqual(2);
          expect(sync.catchUp.pulled).toBeGreaterThanOrEqual(2);
          expect(sync.catchUp.lastCompletedAt).not.toBeNull();
          console.log(
            `node3 catch-up: ${JSON.stringify(sync.catchUp)}, received ${sync.received}`,
          );
        },
      );
    });
  },
  { excludeTags: ['in-process'] },
);
