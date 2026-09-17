import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { Configuration } from '../src/configuration.ts';
import { buildServer } from '../src/server.ts';
import { PetShopStore } from '../src/store/petShopStore.ts';
import type { TraitRelationMode } from '../src/store/traitRelation.ts';

const webAppDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
  'web-app',
  'public',
);

/**
 * The configuration every feature's Fastify instance runs with: a random
 * port (never bound, since features use `inject`) and the real web app
 * directory, matching the pattern `src/routes/animals.test.ts` already uses.
 * `traitRelationMode` defaults to `multi-reference` and is overridden by
 * `createWorld`'s parameter for the scenario outline in `traits.feature`
 * that runs the same filter in both modes.
 */
const worldConfiguration = (
  traitRelationMode: TraitRelationMode,
): Configuration =>
  Object.freeze({
    nodeName: 'node-under-test',
    httpPort: 0,
    logLevel: 'error',
    gitCommit: 'test-commit',
    webAppDirectory,
    traitRelationMode,
  });

/**
 * A pet shop store plus a Fastify instance over it, initialized but not
 * seeded and not listening. The small shared fixture every Gherkin feature
 * in this package builds its scenarios on: a scenario seeds the store
 * itself when it needs seeded data, writes rows directly when it needs a
 * specific fixture, and always talks to the server through `inject` rather
 * than a bound port (roadmap section "Rules that are easy to forget").
 */
export type World = {
  store: PetShopStore;
  server: FastifyInstance;
};

/**
 * Builds a world whose store reads the animal-trait relation in the given
 * mode, `multi-reference` by default (`docs/findings/n-to-m.md`).
 */
export const createWorld = async (
  traitRelationMode: TraitRelationMode = 'multi-reference',
): Promise<World> => {
  const store = new PetShopStore({ traitRelationMode });
  await store.initialize();
  const server = buildServer(worldConfiguration(traitRelationMode), store);
  return { store, server };
};

export const closeWorld = async (world: World): Promise<void> => {
  await world.server.close();
  await world.store.close();
};
