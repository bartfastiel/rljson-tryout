import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TraitRelationMode } from './store/traitRelation.ts';

/**
 * A pino log level, restricted to the values the configured logger accepts.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const logLevels: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
];

const traitRelationModes: readonly TraitRelationMode[] = [
  'multi-reference',
  'junction',
];

/**
 * Whether the node opens its discovery sockets (UDP broadcast on
 * `BROADCAST_PORT`, the TCP probe listener on `HUB_PORT`). `disabled` keeps
 * a single-node run and every unit test free of sockets; the node then
 * reports itself as `standalone` with a node id that lives only for this
 * process.
 */
export type DiscoveryMode = 'enabled' | 'disabled';

const discoveryModes: readonly DiscoveryMode[] = ['enabled', 'disabled'];

/**
 * Which `Io` implementation backs the node's store (`STORAGE` in roadmap
 * section 2.4): `memory` keeps everything in the process and starts empty
 * on every restart, `sqlite` keeps it in `<DATA_DIR>/petshop.sqlite` and
 * survives a restart (`docs/findings/stores.md`). `mssql` arrives with
 * slice C4.
 */
export type StorageKind = 'memory' | 'sqlite';

const storageKinds: readonly StorageKind[] = ['memory', 'sqlite'];

/**
 * The subset of the node configuration (see roadmap section 2.4) that this
 * package uses so far.
 */
export type Configuration = Readonly<{
  nodeName: string;
  httpPort: number;
  logLevel: LogLevel;
  gitCommit: string;
  webAppDirectory: string;
  storage: StorageKind;
  traitRelationMode: TraitRelationMode;
  rljsonDomain: string;
  hubPort: number;
  broadcastPort: number;
  dataDirectory: string;
  publicUrl: string;
  nodeUrls: readonly string[];
  discovery: DiscoveryMode;
}>;

/**
 * The `public` directory of the `web-app` workspace package, resolved from
 * this file so that the default works from any working directory.
 */
const defaultWebAppDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
  'web-app',
  'public',
);

const readWebAppDirectory = (value: string | undefined): string => {
  const directory = resolve(value ?? defaultWebAppDirectory);
  const stats = statSync(directory, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    throw new Error(
      `WEB_APP_DIRECTORY must be an existing directory, got "${directory}"`,
    );
  }

  return directory;
};

/**
 * The `data` directory of this package, resolved from this file so that the
 * default works from any working directory; the image sets `DATA_DIR=/data`.
 */
const defaultDataDirectory = resolve(import.meta.dirname, '..', 'data');

const readPort = (
  variableName: string,
  value: string | undefined,
  defaultPort: number,
): number => {
  if (value === undefined) {
    return defaultPort;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `${variableName} must be an integer between 0 and 65535, got "${value}"`,
    );
  }

  return port;
};

/**
 * Normalizes one node URL for links and for telling a node's own
 * `PUBLIC_URL` apart from the other entries of `NODE_URLS`: lower-cased
 * origin, path without a trailing slash, no query and no fragment.
 */
const readUrl = (variableName: string, value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute URL, got "${value}"`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${variableName} must be an http or https URL, got "${value}"`,
    );
  }

  let pathname = url.pathname;
  while (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return `${url.origin}${pathname}`;
};

const readPublicUrl = (value: string | undefined, httpPort: number): string =>
  readUrl('PUBLIC_URL', value ?? `http://localhost:${httpPort}`);

const readNodeUrls = (value: string | undefined): readonly string[] =>
  Object.freeze(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => readUrl('NODE_URLS', entry)),
  );

const readRljsonDomain = (value: string | undefined): string => {
  if (value === undefined) {
    return 'petshop-local';
  }

  if (value.trim() === '') {
    throw new Error('RLJSON_DOMAIN must not be empty');
  }

  return value;
};

const readDiscoveryMode = (value: string | undefined): DiscoveryMode => {
  if (value === undefined) {
    return 'enabled';
  }

  if (!discoveryModes.includes(value as DiscoveryMode)) {
    throw new Error(
      `DISCOVERY must be one of ${discoveryModes.join(', ')}, got "${value}"`,
    );
  }

  return value as DiscoveryMode;
};

const readStorageKind = (value: string | undefined): StorageKind => {
  if (value === undefined) {
    return 'memory';
  }

  if (!storageKinds.includes(value as StorageKind)) {
    throw new Error(
      `STORAGE must be one of ${storageKinds.join(', ')}, got "${value}"`,
    );
  }

  return value as StorageKind;
};

const readLogLevel = (value: string | undefined): LogLevel => {
  if (value === undefined) {
    return 'info';
  }

  if (!logLevels.includes(value as LogLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of ${logLevels.join(', ')}, got "${value}"`,
    );
  }

  return value as LogLevel;
};

/**
 * Reads which implementation `PetShopStore` uses for the animal-trait n-to-m
 * relation (`docs/findings/n-to-m.md`): the `jsonArray` multi-reference
 * `animals.traitsRefs` (slice B5, the default) or the `animalTraits`
 * junction table (slice B6).
 */
const readTraitRelationMode = (
  value: string | undefined,
): TraitRelationMode => {
  if (value === undefined) {
    return 'multi-reference';
  }

  if (!traitRelationModes.includes(value as TraitRelationMode)) {
    throw new Error(
      `TRAIT_RELATION must be one of ${traitRelationModes.join(', ')}, got "${value}"`,
    );
  }

  return value as TraitRelationMode;
};

/**
 * Reads and validates the environment variables this package understands
 * and returns them as a typed, frozen configuration object. Throws a
 * descriptive error when a value is present but invalid.
 */
export const readConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
): Configuration => {
  const httpPort = readPort('HTTP_PORT', environment.HTTP_PORT, 8080);

  return Object.freeze({
    nodeName: environment.NODE_NAME ?? 'node1',
    httpPort,
    logLevel: readLogLevel(environment.LOG_LEVEL),
    gitCommit: environment.GIT_COMMIT ?? 'unknown',
    webAppDirectory: readWebAppDirectory(environment.WEB_APP_DIRECTORY),
    storage: readStorageKind(environment.STORAGE),
    traitRelationMode: readTraitRelationMode(environment.TRAIT_RELATION),
    rljsonDomain: readRljsonDomain(environment.RLJSON_DOMAIN),
    hubPort: readPort('HUB_PORT', environment.HUB_PORT, 3000),
    broadcastPort: readPort(
      'BROADCAST_PORT',
      environment.BROADCAST_PORT,
      41234,
    ),
    dataDirectory: resolve(environment.DATA_DIR ?? defaultDataDirectory),
    publicUrl: readPublicUrl(environment.PUBLIC_URL, httpPort),
    nodeUrls: readNodeUrls(environment.NODE_URLS),
    discovery: readDiscoveryMode(environment.DISCOVERY),
  });
};
