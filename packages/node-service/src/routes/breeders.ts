import type { FastifyInstance } from 'fastify';

import type { Breeder, PetShopStore } from '../store/petShopStore.ts';

/**
 * Registers `GET /api/breeders`, the list of current breeder versions with
 * the supplying person joined in (roadmap section 2.5). `hash` is the row's
 * `_hash`, the identity of this exact version.
 */
export const registerBreedersRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get('/api/breeders', async (): Promise<Breeder[]> =>
    store.listBreeders(),
  );
};
