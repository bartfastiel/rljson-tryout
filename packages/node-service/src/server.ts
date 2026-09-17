import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Configuration } from './configuration.ts';
import { registerAnimalsRoutes } from './routes/animals.ts';
import { registerSpeciesRoutes } from './routes/species.ts';
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
 * Builds a Fastify instance configured for this service, with the `/health`
 * route, the `/api` routes from roadmap section 2.5 reading from the given
 * store, and the web app served from the configured directory at `/`. Does
 * not start listening; the caller decides when and where to bind.
 */
export const buildServer = (
  configuration: Configuration,
  store: PetShopStore,
): FastifyInstance => {
  const server = Fastify({
    logger: { level: configuration.logLevel },
  });
  const version = readPackageVersion();
  const startedAt = new Date().toISOString();

  server.get('/health', async () => ({
    status: 'ok',
    name: configuration.nodeName,
    version,
    commit: configuration.gitCommit,
    startedAt,
  }));

  registerSpeciesRoutes(server, store);
  registerTraitsRoutes(server, store);
  registerAnimalsRoutes(server, store);

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
