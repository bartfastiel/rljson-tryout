import { BsMem } from '@rljson/bs';
import pino from 'pino';

import { readConfiguration } from './configuration.ts';
import { HubTransport } from './network/hubTransport.ts';
import { NodeDirectory } from './network/nodeDirectory.ts';
import { RoleOrchestrator } from './network/roleOrchestrator.ts';
import { SyncAgent } from './network/syncAgent.ts';
import { buildServer } from './server.ts';
import { createIo } from './store/createIo.ts';
import { PetShopStore } from './store/petShopStore.ts';

const configuration = readConfiguration();
const logger = pino({ level: configuration.logLevel });

// Everything from creating the store on runs inside one try, so that a
// DATA_DIR that cannot be created fails the start with the same log line
// as a store or a port that cannot be opened.
try {
  const store = new PetShopStore(
    createIo(configuration, logger.child({ component: 'storage' })),
    {
      traitRelationMode: configuration.traitRelationMode,
      logger: logger.child({ component: 'store' }),
    },
  );
  // Blobs stay in memory until slice C2 puts them on disk; nothing writes
  // one before slice B12, but the hub transport serves them to peers from
  // here on.
  const blobs = new BsMem();
  const transport = new HubTransport(
    configuration,
    logger.child({ component: 'transport' }),
    store,
    blobs,
  );
  const orchestrator = new RoleOrchestrator(
    configuration,
    logger.child({ component: 'orchestrator' }),
    transport,
  );
  const directory = new NodeDirectory(
    configuration,
    logger.child({ component: 'directory' }),
  );
  const syncAgent = new SyncAgent(
    store,
    transport,
    logger.child({ component: 'sync' }),
  );
  const server = buildServer({
    configuration,
    store,
    orchestrator,
    directory,
    syncAgent,
    logger,
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, 'shutting down');

    try {
      directory.stop();
      await server.close();
      await syncAgent.stop();
      await orchestrator.stop();
      await store.close();
      process.exit(0);
    } catch (error) {
      server.log.error(error, 'error while shutting down');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await store.initialize();
  // The seed is written before the node has a channel; the agent's
  // catch-up announces it to whichever peer lacks it once the node has
  // joined the network.
  syncAgent.start();
  const seedingStarted = performance.now();
  const seeded = await store.seedIfEmpty(configuration.seedSize);
  server.log.info(
    {
      ...seeded,
      seedDurationMilliseconds: Math.round(performance.now() - seedingStarted),
      rssBytes: process.memoryUsage().rss,
    },
    'pet shop store ready',
  );

  const address = await server.listen({
    host: '0.0.0.0',
    port: configuration.httpPort,
  });
  server.log.info(`node service listening on ${address}`);

  // Discovery starts once `/status` answers, so a peer that learns this
  // node's id from a broadcast can immediately correlate it with a URL.
  await orchestrator.start();
  await directory.start();
} catch (error) {
  logger.error(error, 'failed to start the server');
  process.exit(1);
}
