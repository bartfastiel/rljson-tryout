import type { FastifyInstance, FastifyReply } from 'fastify';

import { speciesImagePath, type PetShopStore } from '../store/petShopStore.ts';

/**
 * One species version as `GET /api/species` returns it. `hash` is the
 * row's `_hash`, the identity of this exact version (roadmap section 2.5);
 * `imageUrl` is where the image of this version is served.
 */
type SpeciesResponse = {
  id: string;
  hash: string;
  name: string;
  latinName: string;
  description: string;
  imageUrl: string;
};

type SpeciesImageParams = {
  hash: string;
};

/**
 * The body of an error response, Fastify's default error shape (roadmap
 * section 2.5).
 */
type ErrorBody = {
  statusCode: 404;
  error: 'Not Found';
  message: string;
};

/**
 * How long a browser may keep a species image: a year, and `immutable`
 * because the path names the species version by its hash and the version
 * names the image by its content, so the bytes behind a path never change.
 */
const imageCacheControl = 'public, max-age=31536000, immutable';

/**
 * Registers `GET /api/species`, the list of current species versions, and
 * `GET /api/species/:hash/image`, the PNG of one species version with a
 * cache header that lets a client keep it for good; `404` for a hash no
 * species row has.
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
      imageUrl: speciesImagePath(row._hash),
    })),
  );

  server.get<{ Params: SpeciesImageParams }>(
    '/api/species/:hash/image',
    async (request, reply: FastifyReply): Promise<Buffer | ErrorBody> => {
      const image = await store.speciesImage(request.params.hash);
      if (image === undefined) {
        reply.code(404);
        return {
          statusCode: 404,
          error: 'Not Found',
          message: `No species version with hash "${request.params.hash}".`,
        };
      }
      reply.header('content-type', image.mimeType);
      reply.header('cache-control', imageCacheControl);
      return image.content;
    },
  );
};
