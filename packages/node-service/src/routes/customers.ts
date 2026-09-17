import type { FastifyInstance } from 'fastify';

import type { Customer, PetShopStore } from '../store/petShopStore.ts';

/**
 * Registers `GET /api/customers`, the list of current customer versions
 * with the person joined in (roadmap section 2.5). `hash` is the row's
 * `_hash`, the identity of this exact version.
 */
export const registerCustomersRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get('/api/customers', async (): Promise<Customer[]> =>
    store.listCustomers(),
  );
};
