import type { FastifyInstance } from 'fastify';

import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * One species version as `GET /api/species` returns it. `hash` is the
 * row's `_hash`, the identity of this exact version (roadmap section 2.5).
 */
type SpeciesResponse = {
  id: string;
  hash: string;
  name: string;
  latinName: string;
  description: string;
};

/**
 * Registers `GET /api/species`, the list of current species versions.
 */
export const registerSpeciesRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get('/api/species', async (): Promise<SpeciesResponse[]> =>
    (await store.listSpecies()).map((row) => ({
      id: row.id,
      hash: row._hash,
      name: row.name,
      latinName: row.latinName,
      description: row.description,
    })),
  );
};
