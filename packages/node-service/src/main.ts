import { readConfiguration } from './configuration.ts';
import { buildServer } from './server.ts';
import { PetShopStore } from './store/petShopStore.ts';

const configuration = readConfiguration();
const store = new PetShopStore();
const server = buildServer(configuration, store);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  server.log.info({ signal }, 'shutting down');

  try {
    await server.close();
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
} catch (error) {
  server.log.error(error, 'failed to start the server');
  process.exit(1);
}
