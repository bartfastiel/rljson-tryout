import type { FastifyInstance } from 'fastify';

import type { EventHub } from '../events/eventHub.ts';

/**
 * Registers `GET /api/events`, the server-sent event stream of roadmap
 * section 2.5. The reply is taken over from Fastify (`hijack`) and kept
 * open: the headers tell browsers and proxies not to cache or buffer it
 * (`X-Accel-Buffering` for nginx-style proxies; Traefik flushes
 * `text/event-stream` as it comes), the hub writes every event to it
 * until the client goes away or the server shuts down. Cross-origin
 * reads are allowed like `/status`, so the web app of one node could
 * follow another. No `HEAD` route is derived: it would hold a client
 * that never receives a body.
 */
export const registerEventsRoute = (
  server: FastifyInstance,
  hub: EventHub,
): void => {
  server.get(
    '/api/events',
    { exposeHeadRoute: false },
    (_request, reply): void => {
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
        'access-control-allow-origin': '*',
      });
      response.flushHeaders();
      // The response's `close` fires when the connection is gone as well
      // as when the hub ended the stream; the request's `close` would
      // only fire once the response completed.
      response.on('close', hub.add(response));
    },
  );
};
