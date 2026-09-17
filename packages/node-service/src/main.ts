import { readConfiguration } from './configuration.ts';
import { buildServer } from './server.ts';

const configuration = readConfiguration();
const server = buildServer(configuration);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  server.log.info({ signal }, 'shutting down');

  try {
    await server.close();
    process.exit(0);
  } catch (error) {
    server.log.error(error, 'error while shutting down');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  const address = await server.listen({
    host: '0.0.0.0',
    port: configuration.httpPort,
  });
  server.log.info(`node service listening on ${address}`);
} catch (error) {
  server.log.error(error, 'failed to start the server');
  process.exit(1);
}
