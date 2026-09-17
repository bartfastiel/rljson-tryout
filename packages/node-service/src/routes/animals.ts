import type { AnimalChanges } from '@rljson-tryout/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  AnimalValidationError,
  type AnimalDetail,
  type AnimalVersion,
  type AnimalWithSpecies,
  type PetShopStore,
} from '../store/petShopStore.ts';

type AnimalsQuery = {
  species?: string;
  breeder?: string;
  trait?: string;
};

type AnimalParams = {
  id: string;
};

type AnimalDetailQuery = {
  version?: string;
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

const notFound = (reply: FastifyReply, message: string): ErrorBody => {
  reply.code(404);
  return { statusCode: 404, error: 'Not Found', message };
};

/**
 * The JSON schema Fastify checks `PUT /api/animals/:id` bodies against
 * before the handler runs: the editable fields of roadmap section 2.5,
 * each optional, each of its JSON type, and nothing more is asserted
 * here. The rules that need words or the store (an empty name, a price
 * below zero, a date that is not a calendar date, a field that is not
 * editable, a species or trait no row has) live in `animalChangeProblems`
 * and `PetShopStore.updateAnimal`, whose `AnimalValidationError` carries
 * the message the form shows; the schema only keeps values of the wrong
 * JSON type out of the store. Fastify's default validator coerces where
 * it can (a lone string becomes a one-element array for `traitIds`), so
 * only a value it cannot coerce, such as a word where `priceCents` expects
 * a number, is refused here.
 */
const updateAnimalBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    speciesId: { type: 'string' },
    breederId: { type: 'string' },
    bornOn: { type: 'string' },
    priceCents: { type: 'number' },
    backgroundStory: { type: 'string' },
    traitIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Registers the animal endpoints of roadmap section 2.5: `GET /api/animals`,
 * the list of current animal versions with their species and breeder joined
 * (`hash` is the row's `_hash`, the identity of this exact version),
 * optionally narrowed with `?species=<id>`, `?breeder=<id>`, `?trait=<id>`
 * or any combination; `GET /api/animals/:id`, the current version of one
 * animal with its species and breeder joined, its traits resolved and its
 * full `backgroundStory`, or with `?version=<hash>` that exact version of
 * the animal; `GET /api/animals/:id/history`, every version of the animal
 * newest first with its `timeId`, `previous` and `current` flag; and
 * `PUT /api/animals/:id`, which writes a new version from the current one
 * plus the changed fields in the body and answers `200` with the new
 * version as the detail endpoint serves it. The list never includes
 * `backgroundStory` or `traits`, so it stays light; only the detail
 * endpoint does. An unknown species, breeder or trait id filter answers
 * with an empty list; an unknown animal id, or a version hash the animal
 * never had, answers `404`; changes that cannot be applied answer `400`
 * with a message for the person who filled in the form.
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

  server.get<{ Params: AnimalParams; Querystring: AnimalDetailQuery }>(
    '/api/animals/:id',
    async (request, reply): Promise<AnimalDetail | ErrorBody> => {
      const { id } = request.params;
      const { version } = request.query;
      const animal = await store.getAnimal(id, { version });
      if (animal === undefined) {
        return notFound(
          reply,
          version === undefined
            ? `No animal with id "${id}".`
            : `No version "${version}" of the animal with id "${id}".`,
        );
      }

      return animal;
    },
  );

  server.get<{ Params: AnimalParams }>(
    '/api/animals/:id/history',
    async (request, reply): Promise<AnimalVersion[] | ErrorBody> => {
      const history = await store.getAnimalHistory(request.params.id);
      if (history === undefined) {
        return notFound(reply, `No animal with id "${request.params.id}".`);
      }

      return history;
    },
  );

  server.put<{ Params: AnimalParams; Body: AnimalChanges }>(
    '/api/animals/:id',
    { schema: { body: updateAnimalBodySchema } },
    async (request, reply): Promise<AnimalDetail | ErrorBody> => {
      try {
        const animal = await store.updateAnimal(
          request.params.id,
          request.body,
        );
        if (animal === undefined) {
          return notFound(reply, `No animal with id "${request.params.id}".`);
        }

        return animal;
      } catch (error) {
        if (error instanceof AnimalValidationError) {
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
