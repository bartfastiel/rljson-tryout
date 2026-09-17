import type { FastifyInstance } from 'fastify';

import type {
  AnimalDetail,
  AnimalWithSpecies,
  PetShopStore,
} from '../store/petShopStore.ts';

type AnimalsQuery = {
  species?: string;
};

type AnimalParams = {
  id: string;
};

/**
 * The body of a `404 Not Found` response, Fastify's default error shape
 * (roadmap section 2.5).
 */
type NotFoundBody = {
  statusCode: 404;
  error: 'Not Found';
  message: string;
};

/**
 * Registers `GET /api/animals`, the list of current animal versions with
 * their species joined (roadmap section 2.5; `hash` is the row's `_hash`,
 * the identity of this exact version), optionally narrowed with
 * `?species=<id>`, and `GET /api/animals/:id`, the current version of one
 * animal with its species joined and its full `backgroundStory`. The list
 * never includes `backgroundStory`, so it stays light even once a story runs
 * to several thousand characters; only the detail endpoint does. An unknown
 * species id filter answers with an empty list; an unknown animal id answers
 * `404`.
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

  server.get<{ Params: AnimalParams }>(
    '/api/animals/:id',
    async (request, reply): Promise<AnimalDetail | NotFoundBody> => {
      const animal = await store.getAnimal(request.params.id);
      if (animal === undefined) {
        reply.code(404);
        return {
          statusCode: 404,
          error: 'Not Found',
          message: `No animal with id "${request.params.id}".`,
        };
      }

      return animal;
    },
  );
};
