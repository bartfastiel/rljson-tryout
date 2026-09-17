import type { FastifyInstance } from 'fastify';

import {
  InvoiceValidationError,
  type InvoiceDetail,
  type InvoiceSummary,
  type IssueInvoiceCommand,
  type PetShopStore,
} from '../store/petShopStore.ts';

type InvoiceParams = {
  id: string;
};

/**
 * The body of an error response, Fastify's default error shape (roadmap
 * section 2.5).
 */
type ErrorBody = {
  statusCode: 400 | 404;
  error: 'Bad Request' | 'Not Found';
  message: string;
};

/**
 * The JSON schema Fastify checks `POST /api/invoices` bodies against before
 * the handler runs: the shape of roadmap section 2.5's
 * `{ customerId, items: [{ animalId, quantity }] }` and nothing more. The
 * rules that need the store (does the customer exist, is the quantity at
 * least one, is there an item at all) live in `PetShopStore.issueInvoice`,
 * whose `InvoiceValidationError` carries the message the form shows; the
 * schema only keeps values of the wrong JSON type out of the store.
 */
const issueInvoiceBodySchema = {
  type: 'object',
  required: ['customerId', 'items'],
  properties: {
    customerId: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['animalId', 'quantity'],
        properties: {
          animalId: { type: 'string' },
          quantity: { type: 'number' },
        },
      },
    },
  },
} as const;

/**
 * Registers the invoice endpoints of roadmap section 2.5: `GET
 * /api/invoices`, every invoice with its customer and total, newest first;
 * `GET /api/invoices/:id`, one invoice with its customer, its items with
 * their animals, its total and the hash of the change set that wrote it
 * (`404` for an unknown id); and `POST /api/invoices`, which issues an
 * invoice for `{ customerId, items: [{ animalId, quantity }] }` and answers
 * `201` with the invoice as `GET /api/invoices/:id` would serve it, or
 * `400` with a message for the person who filled in the form when the
 * command names an unknown customer or animal, has no items or a quantity
 * below one.
 */
export const registerInvoicesRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get('/api/invoices', async (): Promise<InvoiceSummary[]> =>
    store.listInvoices(),
  );

  server.get<{ Params: InvoiceParams }>(
    '/api/invoices/:id',
    async (request, reply): Promise<InvoiceDetail | ErrorBody> => {
      const invoice = await store.getInvoice(request.params.id);
      if (invoice === undefined) {
        reply.code(404);
        return {
          statusCode: 404,
          error: 'Not Found',
          message: `No invoice with id "${request.params.id}".`,
        };
      }

      return invoice;
    },
  );

  server.post<{ Body: IssueInvoiceCommand }>(
    '/api/invoices',
    { schema: { body: issueInvoiceBodySchema } },
    async (request, reply): Promise<InvoiceDetail | ErrorBody> => {
      try {
        const invoice = await store.issueInvoice(request.body);
        reply.code(201);
        return invoice;
      } catch (error) {
        if (error instanceof InvoiceValidationError) {
          reply.code(400);
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: error.message,
          };
        }
        throw error;
      }
    },
  );
};
