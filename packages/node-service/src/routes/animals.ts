import type { FastifyInstance } from 'fastify';

import type { AnimalWithSpecies, PetShopStore } from '../store/petShopStore.ts';

type AnimalsQuery = {
  species?: string;
};

/**
 * Registers `GET /api/animals`, the list of current animal versions with
 * their species joined (roadmap section 2.5; `hash` is the row's `_hash`,
 * the identity of this exact version), optionally narrowed with
 * `?species=<id>`. An unknown species id answers with an empty list rather
 * than an error.
 */
export const registerAnimalsRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get<{ Querystring: AnimalsQuery }>(
    '/api/animals',
    async (request): Promise<AnimalWithSpecies[]> =>
      store.listAnimals({ speciesId: request.query.species }),
  );
};
