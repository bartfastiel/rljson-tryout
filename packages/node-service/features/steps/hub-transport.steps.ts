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
  resolve(import.meta.dirname, '..', 'hub-transport.feature'),
);

type AnimalDetailResponse = {
  id: string;
  hash: string;
  priceCents: number;
};

type InvoiceDetailResponse = {
  id: string;
  items: { animal: { id: string } | null; quantity: number }[];
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
 * Two nodes in this process, discovery disabled and the roles given by
 * hand: the hub's transport serves on an ephemeral port, the client's
 * connects to it. Both talk to the outside through `inject`, the way the
 * three-node Compose run of `features/integration` talks to the
 * containers over HTTP.
 */
describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    let hub: World | undefined;
    let client: World | undefined;

    AfterEachScenario(async () => {
      for (const world of [client, hub]) {
        if (world !== undefined) {
          await closeWorld(world);
        }
      }
      hub = undefined;
      client = undefined;
    });

    const connectedNodes = async (): Promise<{ hub: World; client: World }> => {
      hub = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
        nodeName: 'hub-node',
      });
      client = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
        nodeName: 'client-node',
      });
      await hub.store.seedIfEmpty();
      await client.store.seedIfEmpty();
      await hub.transport.becomeHub('127.0.0.1:0');
      await client.transport.becomeClient(
        `127.0.0.1:${hub.transport.boundPort()}`,
      );
      const clientWorld = client;
      await until(async () => {
        const transport = (await status(clientWorld)).transport;
        return transport.role === 'client' && transport.connectedToHub;
      });
      return { hub, client };
    };

    Scenario(
      'A row written on the hub is readable by hash on a client',
      ({ Given, When, Then, And }) => {
        let oldPriceCents = 0;
        let newVersion: AnimalDetailResponse;

        Given('a hub node and a client node connected to it', async () => {
          const nodes = await connectedNodes();
          const current = await nodes.client.server.inject({
            method: 'GET',
            url: '/api/animals/donald-the-third',
          });
          oldPriceCents = current.json<AnimalDetailResponse>().priceCents;
        });

        When(
          'the price of "donald-the-third" is changed to 61000 cents on the hub',
          async () => {
            const response = await hub!.server.inject({
              method: 'PUT',
              url: '/api/animals/donald-the-third',
              payload: { priceCents: 61_000 },
            });
            expect(response.statusCode).toBe(200);
            newVersion = response.json<AnimalDetailResponse>();
          },
        );

        Then(
          'the client serves that version of "donald-the-third" by its hash at 61000 cents',
          async () => {
            const response = await client!.server.inject({
              method: 'GET',
              url: `/api/animals/donald-the-third?version=${newVersion.hash}`,
            });

            expect(response.statusCode).toBe(200);
            expect(response.json<AnimalDetailResponse>()).toMatchObject({
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
            await until(async () => {
              const response = await client!.server.inject({
                method: 'GET',
                url: '/api/animals/donald-the-third',
              });
              return (
                response.json<AnimalDetailResponse>().hash === newVersion.hash
              );
            });

            const response = await client!.server.inject({
              method: 'GET',
              url: '/api/animals/donald-the-third',
            });
            expect(response.json<AnimalDetailResponse>()).toMatchObject({
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
          const response = await hub!.server.inject({
            method: 'POST',
            url: '/api/invoices',
            payload: {
              customerId: 'scrooge-mcduck',
              items: [{ animalId: 'donald-the-third', quantity: 1 }],
            },
          });
          expect(response.statusCode).toBe(201);
          issued = response.json<InvoiceDetailResponse>();
        });

        Then(
          'the client serves that invoice by its id with one item',
          async () => {
            // The change set of the invoice is arriving on the client at
            // the same time: for the moment between its invoice row and
            // its item rows landing, the invoice is current locally without
            // items, so the read is repeated until the item is there.
            let invoice: InvoiceDetailResponse | undefined;
            await until(async () => {
              const response = await client!.server.inject({
                method: 'GET',
                url: `/api/invoices/${issued.id}`,
              });
              invoice = response.json<InvoiceDetailResponse>();
              return response.statusCode === 200 && invoice.items.length > 0;
            });

            expect(invoice?.id).toBe(issued.id);
            expect(invoice?.items).toStrictEqual(issued.items);
            expect(invoice?.items[0]?.animal?.id).toBe('donald-the-third');
          },
        );

        And(
          'the status of the hub counts every client as connected',
          async () => {
            expect((await status(hub!)).transport).toMatchObject({
              role: 'hub',
              connectedClients: 1,
              lastError: null,
            });
            expect((await status(client!)).transport).toMatchObject({
              role: 'client',
              connectedToHub: true,
              lastError: null,
            });
          },
        );
      },
    );
  });
});
