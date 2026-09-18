import type { FastifyInstance } from 'fastify';

import type { SyncAgent, SyncTransfer } from '../network/syncAgent.ts';

type TransfersQuery = {
  peer?: string;
  limit?: string;
};

/**
 * How many transfers one answer may list at most, which is how many the
 * `SyncAgent` remembers; the default is the ten a partner's popup shows.
 */
const maximumTransferLimit = 50;
const defaultTransferLimit = 10;

type ErrorBody = {
  statusCode: 400;
  error: 'Bad Request';
  message: string;
};

/**
 * Registers `GET /api/sync/transfers?peer=<nodeId>&limit=<n>` (roadmap
 * section 2.5, slice D3b): the last change set transfers of this node,
 * newest first, in the shape `/status` lists them under `sync.transfers`;
 * with `peer` only the transfers with that node, the ones naming it and
 * the announcements a hub made to every client at once; `limit` (default
 * 10, at most 50) caps the list and a value out of range answers `400`.
 * Cross-origin readable like `/status`, so the web app of one node could
 * ask another.
 */
export const registerSyncRoutes = (
  server: FastifyInstance,
  syncAgent: Pick<SyncAgent, 'transfers'>,
): void => {
  server.get<{ Querystring: TransfersQuery }>(
    '/api/sync/transfers',
    async (request, reply): Promise<SyncTransfer[] | ErrorBody> => {
      reply.header('access-control-allow-origin', '*');
      const { peer, limit } = request.query;
      const parsedLimit =
        limit === undefined ? defaultTransferLimit : Number(limit);
      if (
        limit?.trim() === '' ||
        !Number.isInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > maximumTransferLimit
      ) {
        reply.code(400);
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: `limit must be a whole number from 1 to ${maximumTransferLimit}, got "${limit}".`,
        };
      }
      return syncAgent.transfers({
        ...(peer === undefined || peer === '' ? {} : { peerNodeId: peer }),
        limit: parsedLimit,
      });
    },
  );
};
