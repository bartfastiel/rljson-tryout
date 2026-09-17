import type { AnimalChanges } from '@rljson-tryout/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  AnimalValidationError,
  defaultPageRequest,
  type AnimalDetail,
  type AnimalPage,
  type AnimalVersion,
  type PageRequest,
  type PetShopStore,
} from '../store/petShopStore.ts';

type AnimalsQuery = {
  species?: string;
  breeder?: string;
  trait?: string;
  q?: string;
  limit?: string;
  offset?: string;
};

/**
 * The most rows one page of `GET /api/animals` may hold (roadmap section
 * 2.5); a larger `limit` is refused rather than clamped, so a client never
 * gets fewer rows than it believes it asked for.
 */
export const maximumPageLimit = 200;

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
 * Thrown while reading the page of a list query when `limit` or `offset`
 * is not a whole number in its range; the route answers `400` with the
 * message.
 */
class PageQueryError extends Error {}

const readWholeNumber = (
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (
    value.trim() === '' ||
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new PageQueryError(
      `${name} must be a whole number from ${minimum} to ${maximum}, got "${value}".`,
    );
  }
  return number;
};

/**
 * The page a list query asks for: `limit` from 1 to `maximumPageLimit`,
 * default 50, and `offset` from 0, default 0. Query values arrive as
 * strings and are read here rather than through a schema, because the
 * server's validator runs without type coercion (`server.ts`).
 */
const readPageRequest = (query: AnimalsQuery): PageRequest => ({
  limit: readWholeNumber(
    'limit',
    query.limit,
    defaultPageRequest.limit,
    1,
    maximumPageLimit,
  ),
  offset: readWholeNumber(
    'offset',
    query.offset,
    defaultPageRequest.offset,
    0,
    Number.MAX_SAFE_INTEGER,
  ),
});

/**
 * The JSON schema Fastify checks `PUT /api/animals/:id` bodies against
 * before the handler runs: the editable fields of roadmap section 2.5,
 * each optional, each of its JSON type, and nothing more is asserted
 * here. The rules that need words or the store (an empty name, a price
 * below zero, a date that is not a calendar date, a field that is not
 * editable, a species or trait no row has) live in `animalChangeProblems`
 * and `PetShopStore.updateAnimal`, whose `AnimalValidationError` carries
 * the message the form shows; the schema only keeps values of the wrong
 * JSON type out of the store. The server's validator runs without type
 * coercion (`server.ts`), so `"100"`, `true` or `null` where a number is
 * expected are refused here rather than rewritten.
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
 * one page of the current animal versions with their species and breeder
 * joined (`hash` is the row's `_hash`, the identity of this exact version)
 * as `{ items, total, limit, offset }`, optionally narrowed with
 * `?species=<id>`, `?breeder=<id>`, `?trait=<id>`, `?q=<text>` (a
 * case-insensitive substring of the name or the species name) or any
 * combination, and sliced with `?limit=<1..200>` (default 50) and
 * `?offset=<n>` (default 0), a value outside those ranges answering `400`;
 * `GET /api/animals/:id`, the current version of one
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
    async (request, reply): Promise<AnimalPage | ErrorBody> => {
      let page: PageRequest;
      try {
        page = readPageRequest(request.query);
      } catch (error) {
        if (error instanceof PageQueryError) {
          reply.code(400);
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: error.message,
          };
        }
        throw error;
      }

      return store.listAnimals(
        {
          speciesId: request.query.species,
          breederId: request.query.breeder,
          traitId: request.query.trait,
          query: request.query.q,
        },
        page,
      );
    },
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
