import type { FastifyInstance } from 'fastify';

import type {
  AnimalDetail,
  AnimalWithSpecies,
  PetShopStore,
} from '../store/petShopStore.ts';

type AnimalsQuery = {
  species?: string;
  breeder?: string;
  trait?: string;
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
 * their species and breeder joined (roadmap section 2.5; `hash` is the
 * row's `_hash`, the identity of this exact version), optionally narrowed
 * with `?species=<id>`, `?breeder=<id>`, `?trait=<id>` or any combination,
 * and `GET /api/animals/:id`, the current version of one animal with its
 * species and breeder joined, its traits resolved and its full
 * `backgroundStory`. The list never includes `backgroundStory` or `traits`,
 * so it stays light; only the detail endpoint does. An unknown species,
 * breeder or trait id filter answers with an empty list; an unknown animal
 * id answers `404`.
 */
export const registerAnimalsRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.get<{ Querystring: AnimalsQuery }>(
    '/api/animals',
    async (request): Promise<AnimalWithSpecies[]> =>
      store.listAnimals({
        speciesId: request.query.species,
        breederId: request.query.breeder,
        traitId: request.query.trait,
      }),
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
