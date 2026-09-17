import type { FastifyInstance } from 'fastify';

import { PetShopStore } from '../src/store/petShopStore.ts';
import type { TraitRelationMode } from '../src/store/traitRelation.ts';
import { buildTestServer } from '../src/testing/testServer.ts';

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
 * mode, `multi-reference` by default (`docs/findings/n-to-m.md`). The
 * server runs with the shared test configuration (`src/testing/testServer.ts`,
 * discovery disabled, never bound) under the node name `node-under-test`.
 */
export const createWorld = async (
  traitRelationMode: TraitRelationMode = 'multi-reference',
): Promise<World> => {
  const store = new PetShopStore({ traitRelationMode });
  await store.initialize();
  const server = buildTestServer(store, {
    nodeName: 'node-under-test',
    traitRelationMode,
  });
  return { store, server };
};

export const closeWorld = async (world: World): Promise<void> => {
  await world.server.close();
  await world.store.close();
};
