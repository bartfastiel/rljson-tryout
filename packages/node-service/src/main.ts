import pino from 'pino';

import { readConfiguration } from './configuration.ts';
import { NodeDirectory } from './network/nodeDirectory.ts';
import { RoleOrchestrator } from './network/roleOrchestrator.ts';
import { buildServer } from './server.ts';
import { PetShopStore } from './store/petShopStore.ts';

const configuration = readConfiguration();
const logger = pino({ level: configuration.logLevel });
const store = new PetShopStore({
  traitRelationMode: configuration.traitRelationMode,
});
const orchestrator = new RoleOrchestrator(
  configuration,
  logger.child({ component: 'orchestrator' }),
);
const directory = new NodeDirectory(
  configuration,
  logger.child({ component: 'directory' }),
);
const server = buildServer({
  configuration,
  store,
  orchestrator,
  directory,
  logger,
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  server.log.info({ signal }, 'shutting down');

  try {
    directory.stop();
    await server.close();
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

try {
  await store.initialize();
  const seeded = await store.seedIfEmpty();
  server.log.info(seeded, 'pet shop store ready');

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
  server.log.error(error, 'failed to start the server');
  process.exit(1);
}
