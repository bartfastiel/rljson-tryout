import { invoicesSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';

const summaryKeys = [
  'customer',
  'hash',
  'id',
  'invoiceNumber',
  'issuedOn',
  'itemCount',
  'status',
  'totalCents',
];

const detailKeys = [
  'changeSetHash',
  'customer',
  'hash',
  'id',
  'invoiceNumber',
  'issuedOn',
  'items',
  'status',
  'totalCents',
];

describe('/api/invoices', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = new PetShopStore({ today: () => '2026-09-17' });
    await store.initialize();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  describe('GET /api/invoices', () => {
    it('answers with an empty list when nothing is seeded', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/invoices',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toStrictEqual([]);
    });

    it('lists the six seeded invoices newest first, in the documented shape', async () => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'GET',
        url: '/api/invoices',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      const invoices = response.json<Record<string, unknown>[]>();
      expect(invoices).toHaveLength(invoicesSeed.length);
      expect(invoices[0]).toMatchObject({
        invoiceNumber: '2026-0006',
        customer: { id: 'scrooge-mcduck', personName: 'Scrooge McDuck' },
      });
      for (const entry of invoices) {
        expect(Object.keys(entry).sort()).toStrictEqual(summaryKeys);
        expect(
          Object.keys(entry.customer as Record<string, unknown>).sort(),
        ).toStrictEqual(['customerNumber', 'id', 'personName']);
      }
    });
  });

  describe('GET /api/invoices/:id', () => {
    it('answers 404 in the default error shape for an unknown id', async () => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'GET',
        url: '/api/invoices/no-such-invoice',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toStrictEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'No invoice with id "no-such-invoice".',
      });
    });

    it('serves a seeded invoice with its customer, items and change set hash', async () => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'GET',
        url: '/api/invoices/invoice-2026-0001',
      });

      expect(response.statusCode).toBe(200);
      const invoice = response.json<Record<string, unknown>>();
      expect(Object.keys(invoice).sort()).toStrictEqual(detailKeys);
      expect(invoice).toMatchObject({
        id: 'invoice-2026-0001',
        invoiceNumber: '2026-0001',
        issuedOn: '2026-01-12',
        status: 'paid',
        customer: {
          id: 'scrooge-mcduck',
          customerNumber: 'C-0001',
          person: { name: 'Scrooge McDuck', city: 'Duckburg' },
        },
        totalCents: 61000 + 47000,
      });
      expect(invoice.changeSetHash).toEqual(expect.any(String));
      const items = invoice.items as Record<string, unknown>[];
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(Object.keys(item).sort()).toStrictEqual([
          'animal',
          'hash',
          'id',
          'lineTotalCents',
          'quantity',
          'unitPriceCents',
        ]);
        expect(
          Object.keys(item.animal as Record<string, unknown>).sort(),
        ).toStrictEqual(['id', 'name', 'speciesName']);
      }
    });
  });

  describe('POST /api/invoices', () => {
    it('issues an invoice and answers 201 with the invoice as the detail endpoint serves it', async () => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId: 'scrooge-mcduck',
          items: [{ animalId: 'donald-the-third', quantity: 1 }],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      const issued = response.json<Record<string, unknown>>();
      expect(Object.keys(issued).sort()).toStrictEqual(detailKeys);
      expect(issued).toMatchObject({
        id: 'invoice-2026-0007',
        invoiceNumber: '2026-0007',
        issuedOn: '2026-09-17',
        status: 'open',
        customer: { id: 'scrooge-mcduck', customerNumber: 'C-0001' },
        items: [
          {
            animal: { id: 'donald-the-third', name: 'Donald the Third' },
            quantity: 1,
            unitPriceCents: 52000,
            lineTotalCents: 52000,
          },
        ],
        totalCents: 52000,
      });

      const detail = await server.inject({
        method: 'GET',
        url: '/api/invoices/invoice-2026-0007',
      });
      expect(detail.json()).toStrictEqual(issued);

      const list = await server.inject({ method: 'GET', url: '/api/invoices' });
      expect(list.json<{ id: string }[]>()[0]?.id).toBe('invoice-2026-0007');
    });

    it.each([
      [
        'no items',
        { customerId: 'scrooge-mcduck', items: [] },
        'An invoice needs at least one item.',
      ],
      [
        'a quantity below one',
        {
          customerId: 'scrooge-mcduck',
          items: [{ animalId: 'donald-the-third', quantity: 0 }],
        },
        'Item 1: the quantity must be a whole number of at least 1, got 0.',
      ],
      [
        'an unknown customer',
        {
          customerId: 'magica-de-spell',
          items: [{ animalId: 'donald-the-third', quantity: 1 }],
        },
        'No customer with id "magica-de-spell".',
      ],
      [
        'an unknown animal',
        {
          customerId: 'scrooge-mcduck',
          items: [{ animalId: 'gizmoduck', quantity: 1 }],
        },
        'No animal with id "gizmoduck".',
      ],
    ])(
      'answers 400 in the default error shape for %s',
      async (_description, payload, message) => {
        await store.seedIfEmpty();

        const response = await server.inject({
          method: 'POST',
          url: '/api/invoices',
          payload,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toStrictEqual({
          statusCode: 400,
          error: 'Bad Request',
          message,
        });
        const list = await server.inject({
          method: 'GET',
          url: '/api/invoices',
        });
        expect(list.json()).toHaveLength(invoicesSeed.length);
      },
    );

    it('answers 400 when the body has the wrong shape', async () => {
      await store.seedIfEmpty();

      const response = await server.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: { customerId: 'scrooge-mcduck', items: 'donald-the-third' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: expect.stringContaining('items') as string,
      });
    });
  });
});
