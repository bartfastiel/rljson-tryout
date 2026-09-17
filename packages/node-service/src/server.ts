import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';

import type { Configuration } from './configuration.ts';
import { registerSpeciesRoutes } from './routes/species.ts';
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
 * route and the `/api` routes from roadmap section 2.5 reading from the
 * given store. Does not start listening; the caller decides when and where
 * to bind.
 */
export const buildServer = (
  configuration: Configuration,
  store: PetShopStore,
): FastifyInstance => {
  const server = Fastify({
    logger: { level: configuration.logLevel },
  });
  const version = readPackageVersion();

  server.get('/health', async () => ({
    status: 'ok',
    name: configuration.nodeName,
    version,
    commit: configuration.gitCommit,
  }));

  registerSpeciesRoutes(server, store);

  return server;
};
