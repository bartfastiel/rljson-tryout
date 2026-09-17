import type { FastifyInstance } from 'fastify';

import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * One animal version as `GET /api/animals` returns it, with the species it
 * belongs to already joined in (roadmap section 2.5). `hash` is the row's
 * `_hash`, the identity of this exact version.
 */
type AnimalResponse = {
  id: string;
  hash: string;
  name: string;
  speciesId: string;
  speciesName: string;
  bornOn: string;
  priceCents: number;
};

type AnimalsQuery = {
  species?: string;
};

/**
 * Registers `GET /api/animals`, the list of current animal versions with
 * their species joined, optionally narrowed with `?species=<id>`. An
 * unknown species id answers with an empty list rather than an error.
 */
export const registerAnimalsRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get<{ Querystring: AnimalsQuery }>(
    '/api/animals',
    async (request): Promise<AnimalResponse[]> =>
      store.listAnimals({ speciesId: request.query.species }),
  );
};
