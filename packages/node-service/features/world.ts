import type { SeedSize } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';

import type { StorageKind } from '../src/configuration.ts';
import type { HubTransport } from '../src/network/hubTransport.ts';
import type { PetShopStore } from '../src/store/petShopStore.ts';
import type { TraitRelationMode } from '../src/store/traitRelation.ts';
import {
  buildTestServer,
  buildTestTransport,
} from '../src/testing/testServer.ts';
import { testStore } from '../src/testing/testStores.ts';

/**
 * A pet shop store plus a Fastify instance over it, initialized but not
 * seeded and not listening, and the hub transport of that node, idle
 * until a scenario gives the node a role. The small shared fixture every
 * Gherkin feature in this package builds its scenarios on: a scenario
 * seeds the store itself when it needs seeded data, writes rows directly
 * when it needs a specific fixture, and always talks to the server through
 * `inject` rather than a bound port (roadmap section "Rules that are easy
 * to forget"); a hub transport binds an ephemeral port only.
 */
export type World = {
  store: PetShopStore;
  server: FastifyInstance;
  transport: HubTransport;
};

/**
 * What a scenario chooses about its world: which `STORAGE` backs the
 * store (`memory` or `sqlite`; every feature runs over both through
 * `describe.each(storageKinds)`), where a SQLite file goes, which
 * animal-trait relation the store reads (`multi-reference` by default,
 * `docs/findings/n-to-m.md`), which `SEED_SIZE` the node reports, the
 * node's name, and the hub port its transport binds when it becomes hub
 * (`0`, an ephemeral one, unless a scenario restarts a hub on the port
 * its clients still follow).
 */
export type WorldOptions = {
  storage: StorageKind;
  dataDirectory: string;
  traitRelationMode?: TraitRelationMode;
  seedSize?: SeedSize;
  nodeName?: string;
  hubPort?: number;
};

/**
 * Builds a world over a store of the given kind. The server runs with the
 * shared test configuration (`src/testing/testServer.ts`, discovery
 * disabled, never bound) under the node name `node-under-test` unless the
 * scenario names it, reporting the same `storage` the store was built
 * with.
 */
export const createWorld = async ({
  storage,
  dataDirectory,
  traitRelationMode = 'multi-reference',
  seedSize = 'small',
  nodeName = 'node-under-test',
  hubPort = 0,
}: WorldOptions): Promise<World> => {
  const store = await testStore(
    { storage, dataDirectory },
    { traitRelationMode },
  );
  const overrides = {
    nodeName,
    storage,
    dataDirectory,
    traitRelationMode,
    seedSize,
    hubPort,
  };
  const transport = buildTestTransport(store, overrides);
  const server = buildTestServer(store, overrides, transport);
  return { store, server, transport };
};

export const closeWorld = async (world: World): Promise<void> => {
  await world.server.close();
  await world.transport.stop();
  await world.store.close();
};
