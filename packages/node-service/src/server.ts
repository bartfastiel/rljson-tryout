import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { Configuration } from './configuration.ts';
import { EventHub, type EventHubOptions } from './events/eventHub.ts';
import { LiveEvents } from './events/liveEvents.ts';
import type { TopologyWatchOptions } from './events/topologyWatch.ts';
import type { NodeDirectory } from './network/nodeDirectory.ts';
import type { RoleOrchestrator } from './network/roleOrchestrator.ts';
import type { SyncAgent } from './network/syncAgent.ts';
import { registerAnimalsRoutes } from './routes/animals.ts';
import { registerBreedersRoutes } from './routes/breeders.ts';
import { registerCustomersRoutes } from './routes/customers.ts';
import { registerEventsRoute } from './routes/events.ts';
import { registerInvoicesRoutes } from './routes/invoices.ts';
import { registerSpeciesRoutes } from './routes/species.ts';
import { registerStatsRoute } from './routes/stats.ts';
import { registerStatusRoute } from './routes/status.ts';
import { registerTraitsRoutes } from './routes/traits.ts';
import type { PetShopStore } from './store/petShopStore.ts';

const packageDirectory = dirname(fileURLToPath(import.meta.url));

const readPackageVersion = (): string => {
  const packageJsonPath = join(packageDirectory, '..', 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    version: string;
  };
  return packageJson.version;
};

/**
 * Everything the HTTP server answers from: the configuration, the store
 * behind the `/api` routes, the network components behind `/status`, the
 * logger the whole process shares (`main.ts` creates it once with the
 * configured level; the tests pass a silent one), and the timings of the
 * event stream, which only the tests shorten.
 */
export type ServerDependencies = Readonly<{
  configuration: Configuration;
  store: PetShopStore;
  orchestrator: RoleOrchestrator;
  directory: NodeDirectory;
  syncAgent: SyncAgent;
  logger: FastifyBaseLogger;
  events?: EventHubOptions & TopologyWatchOptions;
}>;

/**
 * Builds a Fastify instance configured for this service, with the `/health`
 * and `/status` routes, the `/api` routes from roadmap section 2.5 reading
 * from the given store, the `/api/events` stream fed by the store, the
 * sync agent and the network components from the moment the server is
 * ready until it closes, and the web app served from the configured
 * directory at `/`. Does not start listening; the caller decides when and
 * where to bind.
 */
export const buildServer = ({
  configuration,
  store,
  orchestrator,
  directory,
  syncAgent,
  logger,
  events = {},
}: ServerDependencies): FastifyInstance => {
  // Fastify's default validator coerces body values to the schema's type
  // (`"100"` and `true` become numbers, `null` becomes `0` or `""`), which
  // would turn an invalid value into a silently different valid one before
  // the domain rules see it. Bodies are validated as sent instead.
  const server = Fastify({
    loggerInstance: logger,
    ajv: { customOptions: { coerceTypes: false } },
  });
  const version = readPackageVersion();
  const startedAt = new Date();

  // Browsers on other nodes probe this route, so it allows cross-origin
  // reads, like `/status` does.
  server.get('/health', async (_request, reply) => {
    reply.header('access-control-allow-origin', '*');
    return {
      status: 'ok',
      name: configuration.nodeName,
      version,
      commit: configuration.gitCommit,
      startedAt: startedAt.toISOString(),
    };
  });

  registerStatusRoute(server, {
    configuration,
    store,
    orchestrator,
    directory,
    syncAgent,
  });
  registerStatsRoute(server, { configuration, store, startedAt });
  registerSpeciesRoutes(server, store);
  registerTraitsRoutes(server, store);
  registerBreedersRoutes(server, store);
  registerCustomersRoutes(server, store);
  registerAnimalsRoutes(server, store);
  registerInvoicesRoutes(server, store);

  const eventHub = new EventHub(logger.child({ component: 'events' }), events);
  const liveEvents = new LiveEvents(
    eventHub,
    { configuration, store, orchestrator, directory, syncAgent },
    events,
  );
  registerEventsRoute(server, eventHub);
  server.addHook('onReady', async () => {
    liveEvents.start();
  });
  // `preClose` runs before Fastify waits for the open connections to end,
  // which a stream never would on its own.
  server.addHook('preClose', async () => {
    liveEvents.stop();
    eventHub.close();
  });

  // The app has no build step and no hashed file names, so browsers must
  // revalidate the entry document on every load to pick up new versions.
  server.register(fastifyStatic, {
    root: configuration.webAppDirectory,
    setHeaders: (reply, filePath) => {
      if (basename(filePath) === 'index.html') {
        reply.header('cache-control', 'no-cache');
      }
    },
  });

  return server;
};
