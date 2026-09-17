import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BsMem } from '@rljson/bs';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';

import type { Configuration } from '../configuration.ts';
import { HubTransport } from '../network/hubTransport.ts';
import { NodeDirectory } from '../network/nodeDirectory.ts';
import { RoleOrchestrator } from '../network/roleOrchestrator.ts';
import { buildServer } from '../server.ts';
import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * The configuration every unit test and Gherkin feature builds its Fastify
 * instance with: a random port (never bound, since tests use `inject`),
 * the real web app directory, discovery disabled so that no test opens a
 * socket, and a data directory nothing writes to while discovery is off
 * and the store is the in-memory one; a test over the SQLite store passes
 * its own `storage` and `dataDirectory` (`testStores.ts`).
 */
export const testConfiguration: Configuration = Object.freeze({
  nodeName: 'node1',
  httpPort: 0,
  logLevel: 'error',
  gitCommit: 'test-commit',
  webAppDirectory: resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'web-app',
    'public',
  ),
  storage: 'memory',
  seedSize: 'small',
  traitRelationMode: 'multi-reference',
  rljsonDomain: 'petshop-test',
  hubPort: 0,
  broadcastPort: 0,
  dataDirectory: join(tmpdir(), 'rljson-tryout-node-service-tests'),
  publicUrl: 'http://localhost:8080',
  nodeUrls: [],
  nodeStatusUrls: [],
  discovery: 'disabled',
});

export const silentLogger = (): FastifyBaseLogger => pino({ level: 'silent' });

/**
 * A hub transport over the given store with a silent logger, wired the
 * way `main.ts` wires it (the store's `Io` lent to `@rljson/server`, blobs
 * in memory). Not started: it binds and connects only when a test drives
 * it. Port `0` in the test configuration keeps a hub on an ephemeral port.
 */
export const buildTestTransport = (
  store: PetShopStore,
  overrides: Partial<Configuration> = {},
): HubTransport =>
  new HubTransport(
    { ...testConfiguration, ...overrides },
    silentLogger(),
    store,
    new BsMem(),
  );

/**
 * A server over the given store with a silent logger and network
 * components that are built but not started: `/status` then reports the
 * role `starting` with no node id and a standalone transport, and nothing
 * polls, binds or connects.
 */
export const buildTestServer = (
  store: PetShopStore,
  overrides: Partial<Configuration> = {},
  transport: HubTransport = buildTestTransport(store, overrides),
): FastifyInstance => {
  const configuration: Configuration = Object.freeze({
    ...testConfiguration,
    ...overrides,
  });
  const logger = silentLogger();
  return buildServer({
    configuration,
    store,
    orchestrator: new RoleOrchestrator(configuration, logger, transport),
    directory: new NodeDirectory(configuration, logger),
    logger,
  });
};
