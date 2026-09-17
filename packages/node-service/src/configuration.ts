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
 * The subset of the node configuration (see roadmap section 2.4) that this
 * package uses so far.
 */
export type Configuration = Readonly<{
  nodeName: string;
  httpPort: number;
  logLevel: LogLevel;
  gitCommit: string;
  webAppDirectory: string;
  traitRelationMode: TraitRelationMode;
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

const readHttpPort = (value: string | undefined): number => {
  if (value === undefined) {
    return 8080;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `HTTP_PORT must be an integer between 0 and 65535, got "${value}"`,
    );
  }

  return port;
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
): Configuration =>
  Object.freeze({
    nodeName: environment.NODE_NAME ?? 'node1',
    httpPort: readHttpPort(environment.HTTP_PORT),
    logLevel: readLogLevel(environment.LOG_LEVEL),
    gitCommit: environment.GIT_COMMIT ?? 'unknown',
    webAppDirectory: readWebAppDirectory(environment.WEB_APP_DIRECTORY),
    traitRelationMode: readTraitRelationMode(environment.TRAIT_RELATION),
  });
