import {
  detectedImageMediaType,
  isUploadedImageMediaType,
  maximumUploadedImageBytes,
  uploadedImageMediaTypes,
  type HashedSpeciesRow,
} from '@rljson-tryout/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { speciesImagePath, type PetShopStore } from '../store/petShopStore.ts';

/**
 * One species version as `GET /api/species` returns it and
 * `POST /api/species/:id/image` answers with. `hash` is the row's `_hash`,
 * the identity of this exact version (roadmap section 2.5); `imageUrl` is
 * where the image of this version is served.
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

type SpeciesParams = {
  id: string;
};

/**
 * The body of an error response, Fastify's default error shape (roadmap
 * section 2.5).
 */
type ErrorBody = {
  statusCode: 400 | 404 | 415;
  error: 'Bad Request' | 'Not Found' | 'Unsupported Media Type';
  message: string;
};

const notFound = (reply: FastifyReply, message: string): ErrorBody => {
  reply.code(404);
  return { statusCode: 404, error: 'Not Found', message };
};

const unsupportedMediaType = (
  reply: FastifyReply,
  message: string,
): ErrorBody => {
  reply.code(415);
  return { statusCode: 415, error: 'Unsupported Media Type', message };
};

/**
 * How long a browser may keep a species image: a year, and `immutable`
 * because the path names the species version by its hash and the version
 * names the image by its content, so the bytes behind a path never change.
 */
const imageCacheControl = 'public, max-age=31536000, immutable';

const speciesResponse = (row: HashedSpeciesRow): SpeciesResponse => ({
  id: row.id,
  hash: row._hash,
  name: row.name,
  latinName: row.latinName,
  description: row.description,
  imageUrl: speciesImagePath(row._hash),
});

/**
 * Registers `GET /api/species`, the list of current species versions,
 * `GET /api/species/:hash/image`, the image of one species version with a
 * cache header that lets a client keep it for good (`404` for a hash no
 * species row has, and `404` with its own message for a version whose
 * image neither this node nor the network holds), and
 * `POST /api/species/:id/image` (slice D5): the raw bytes of a PNG or
 * JPEG with the matching `Content-Type`, at most one mebibyte, checked by
 * their first bytes, written as a new version of the species; answers
 * `200` with the version as the list serves it, `404` for an unknown id,
 * `415` for another media type or bytes that are not the declared image,
 * `413` for a bigger body (Fastify's own answer for the route's body
 * limit) and `400` for an empty one.
 */
export const registerSpeciesRoutes = (
  server: FastifyInstance,
  store: PetShopStore,
): void => {
  server.addContentTypeParser(
    [...uploadedImageMediaTypes],
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  server.get('/api/species', async (): Promise<SpeciesResponse[]> =>
    (await store.listSpecies()).map(speciesResponse),
  );

  server.get<{ Params: SpeciesImageParams }>(
    '/api/species/:hash/image',
    async (request, reply: FastifyReply): Promise<Buffer | ErrorBody> => {
      const lookup = await store.speciesImage(request.params.hash);
      if (lookup.outcome === 'unknown-version') {
        return notFound(
          reply,
          `No species version with hash "${request.params.hash}".`,
        );
      }
      if (lookup.outcome === 'unavailable') {
        return notFound(
          reply,
          `The image of species version "${request.params.hash}" (blob ${lookup.blobId}) is held neither by this node nor by any node it could ask: ${lookup.reason}.`,
        );
      }
      reply.header('content-type', lookup.image.mimeType);
      reply.header('cache-control', imageCacheControl);
      return lookup.image.content;
    },
  );

  // The body is whatever the parser of the declared media type produced:
  // a `Buffer` from the parser above, something else from Fastify's own
  // JSON and text parsers, which the handler refuses by the type first.
  server.post<{ Params: SpeciesParams; Body: unknown }>(
    '/api/species/:id/image',
    { bodyLimit: maximumUploadedImageBytes },
    async (request, reply): Promise<SpeciesResponse | ErrorBody> => {
      const declared = request.headers['content-type']?.split(';')[0]?.trim();
      if (declared === undefined || !isUploadedImageMediaType(declared)) {
        return unsupportedMediaType(
          reply,
          `An image is uploaded as ${uploadedImageMediaTypes.join(' or ')}, not as "${declared ?? ''}".`,
        );
      }
      const content = request.body;
      if (!Buffer.isBuffer(content) || content.length === 0) {
        reply.code(400);
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'The body is empty; send the bytes of the image.',
        };
      }
      const detected = detectedImageMediaType(content);
      if (detected === null) {
        return unsupportedMediaType(
          reply,
          `The body does not start like a PNG or JPEG image, whatever it was declared as.`,
        );
      }
      if (detected !== declared) {
        return unsupportedMediaType(
          reply,
          `The body is ${detected}, not the declared ${declared}.`,
        );
      }
      const species = await store.updateSpeciesImage(
        request.params.id,
        content,
        detected,
      );
      if (species === undefined) {
        return notFound(reply, `No species with id "${request.params.id}".`);
      }
      return speciesResponse(species);
    },
  );
};
