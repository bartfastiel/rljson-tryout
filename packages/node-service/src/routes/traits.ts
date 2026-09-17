import type { FastifyInstance } from 'fastify';

import type { PetShopStore, Trait } from '../store/petShopStore.ts';

/**
 * Registers `GET /api/traits`, the list of current trait versions (roadmap
 * section 2.5). `hash` is the row's `_hash`, the identity of this exact
 * version.
 */
export const registerTraitsRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get('/api/traits', async (): Promise<Trait[]> => store.listTraits());
};
