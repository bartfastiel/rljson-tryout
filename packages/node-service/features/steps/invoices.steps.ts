import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { animalsSeed, invoicesSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { describe, expect } from 'vitest';

import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'invoices.feature'),
);

type InvoiceListEntry = {
  id: string;
  invoiceNumber: string;
  customer: { personName: string | null } | null;
  totalCents: number;
  itemCount: number;
};

type InvoiceDetailResponse = {
  id: string;
  status: string;
  customer: { person: { name: string } | null } | null;
  items: { animal: { id: string } | null; quantity: number }[];
  totalCents: number;
  changeSetHash: string | null;
};

type ErrorResponse = {
  statusCode: number;
  error: string;
  message: string;
};

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

const issueInvoice = (
  world: World,
  items: { animalId: string; quantity: number }[],
): Promise<Response> =>
  world.server.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: { customerId: 'scrooge-mcduck', items },
  });

const listInvoices = async (world: World): Promise<InvoiceListEntry[]> => {
  const response = await world.server.inject({
    method: 'GET',
    url: '/api/invoices',
  });
  return response.json<InvoiceListEntry[]>();
};

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    let world: World | undefined;

    AfterEachScenario(async () => {
      if (world !== undefined) {
        await closeWorld(world);
        world = undefined;
      }
    });

    Scenario('Scrooge buys Donald the duck', ({ Given, When, Then, And }) => {
      let response: Response;

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld({
          storage,
          dataDirectory: dataDirectories.next(),
        });
        await world.store.seedIfEmpty();
      });

      When('Scrooge McDuck buys the animal "donald-the-third"', async () => {
        response = await issueInvoice(world!, [
          { animalId: 'donald-the-third', quantity: 1 },
        ]);
      });

      Then(
        'the node answers 201 with an open invoice for "Scrooge McDuck"',
        () => {
          expect(response.statusCode).toBe(201);
          const invoice = response.json<InvoiceDetailResponse>();
          expect(invoice.status).toBe('open');
          expect(invoice.customer?.person?.name).toBe('Scrooge McDuck');
        },
      );

      And('the invoice list shows that invoice with one item', async () => {
        const issued = response.json<InvoiceDetailResponse>();
        const invoices = await listInvoices(world!);
        const listed = invoices.find((invoice) => invoice.id === issued.id);

        expect(listed).toBeDefined();
        expect(listed!.itemCount).toBe(1);
        expect(listed!.customer?.personName).toBe('Scrooge McDuck');
      });

      And(
        'the invoice total equals the price of "donald-the-third"',
        async () => {
          const donald = animalsSeed.find(
            (row) => row.id === 'donald-the-third',
          );
          expect(donald).toBeDefined();
          const issued = response.json<InvoiceDetailResponse>();
          const invoices = await listInvoices(world!);
          const listed = invoices.find((invoice) => invoice.id === issued.id);

          expect(issued.totalCents).toBe(donald!.priceCents);
          expect(listed!.totalCents).toBe(donald!.priceCents);
        },
      );

      And('the invoice detail names the change set that wrote it', async () => {
        const issued = response.json<InvoiceDetailResponse>();
        const detail = await world!.server.inject({
          method: 'GET',
          url: `/api/invoices/${issued.id}`,
        });

        expect(detail.statusCode).toBe(200);
        const invoice = detail.json<InvoiceDetailResponse>();
        expect(invoice.changeSetHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(invoice.changeSetHash).toBe(issued.changeSetHash);
      });
    });

    Scenario(
      'An invoice without items is refused',
      ({ Given, When, Then, And }) => {
        let response: Response;

        Given('a freshly seeded pet shop store', async () => {
          world = await createWorld({
            storage,
            dataDirectory: dataDirectories.next(),
          });
          await world.store.seedIfEmpty();
        });

        When('Scrooge McDuck sends an invoice with no items', async () => {
          response = await issueInvoice(world!, []);
        });

        Then(
          'the node answers 400 with the message "An invoice needs at least one item."',
          () => {
            expect(response.statusCode).toBe(400);
            expect(response.json<ErrorResponse>()).toStrictEqual({
              statusCode: 400,
              error: 'Bad Request',
              message: 'An invoice needs at least one item.',
            });
          },
        );

        And('the invoice list is unchanged', async () => {
          expect(await listInvoices(world!)).toHaveLength(invoicesSeed.length);
        });
      },
    );

    Scenario(
      'An invoice for an unknown animal is refused',
      ({ Given, When, Then, And }) => {
        let response: Response;

        Given('a freshly seeded pet shop store', async () => {
          world = await createWorld({
            storage,
            dataDirectory: dataDirectories.next(),
          });
          await world.store.seedIfEmpty();
        });

        When('Scrooge McDuck buys the animal "gizmoduck"', async () => {
          response = await issueInvoice(world!, [
            { animalId: 'gizmoduck', quantity: 1 },
          ]);
        });

        Then(
          'the node answers 400 with a message naming the animal "gizmoduck"',
          () => {
            expect(response.statusCode).toBe(400);
            const error = response.json<ErrorResponse>();
            expect(error.error).toBe('Bad Request');
            expect(error.message).toBe('No animal with id "gizmoduck".');
          },
        );

        And('the invoice list is unchanged', async () => {
          expect(await listInvoices(world!)).toHaveLength(invoicesSeed.length);
        });
      },
    );
  });
});
