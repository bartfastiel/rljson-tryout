import type { FastifyInstance } from 'fastify';

import type { ChangeSetPayload, PetShopStore } from '../store/petShopStore.ts';

type ChangeSetParams = {
  hash: string;
};

type ErrorBody = {
  statusCode: 404;
  error: 'Not Found';
  message: string;
};

/**
 * Registers `GET /api/change-sets/:hash` (roadmap section 2.5, slice
 * D3b): one change set this node holds with the content of every row it
 * names and, per data row, the row of the version it supersedes when the
 * store holds it, `{ hash, id, items: [{ table, ref, row, previousRow }] }`;
 * `404` for a change set this node does not hold.
 */
export const registerChangeSetsRoutes = (
  server: FastifyInstance,
  store: Pick<PetShopStore, 'changeSetPayload'>,
): void => {
  server.get<{ Params: ChangeSetParams }>(
    '/api/change-sets/:hash',
    async (request, reply): Promise<ChangeSetPayload | ErrorBody> => {
      const payload = await store.changeSetPayload(request.params.hash);
      if (payload === undefined) {
        reply.code(404);
        return {
          statusCode: 404,
          error: 'Not Found',
          message: `This node holds no change set with hash "${request.params.hash}".`,
        };
      }
      return payload;
    },
  );
};
