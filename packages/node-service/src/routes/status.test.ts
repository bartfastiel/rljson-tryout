import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Configuration } from '../configuration.ts';
import { NodeDirectory } from '../network/nodeDirectory.ts';
import { RoleOrchestrator } from '../network/roleOrchestrator.ts';
import { buildServer } from '../server.ts';
import type { PetShopStore } from '../store/petShopStore.ts';
import {
  FakeDiscoveryManager,
  fakeNodeInfo,
} from '../testing/fakeDiscoveryManager.ts';
import {
  buildTestServer,
  buildTestSyncAgent,
  buildTestTransport,
  silentLogger,
  testConfiguration,
} from '../testing/testServer.ts';
import { memoryStore, testStore } from '../testing/testStores.ts';

const expectedTables = [
  'species',
  'speciesInsertHistory',
  'traits',
  'traitsInsertHistory',
  'persons',
  'personsInsertHistory',
  'breeders',
  'breedersInsertHistory',
  'animals',
  'animalsInsertHistory',
  'animalTraits',
  'animalTraitsInsertHistory',
  'customers',
  'customersInsertHistory',
  'invoices',
  'invoicesInsertHistory',
  'invoiceItems',
  'invoiceItemsInsertHistory',
  'changeSets',
  'changeSetsInsertHistory',
];

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const seededStore = async (): Promise<PetShopStore> => {
  const store = await memoryStore();
  await store.seedIfEmpty();
  cleanups.push(() => store.close());
  return store;
};

const closing = (server: FastifyInstance): FastifyInstance => {
  cleanups.push(() => server.close());
  return server;
};

/**
 * A server whose orchestrator runs over a fake manager (so that the test
 * decides the topology) and whose directory polls a fake `fetch` (so that
 * the test decides what the other nodes report).
 */
const serverOverFakeNetwork = async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'status-route-'));
  cleanups.push(() => rmSync(dataDirectory, { recursive: true, force: true }));
  const configuration: Configuration = Object.freeze({
    ...testConfiguration,
    nodeName: 'node1',
    publicUrl: 'http://node1:8080',
    nodeUrls: ['http://node1:8080', 'http://node2:8080', 'http://node3:8080'],
    nodeStatusUrls: [
      'http://node1:8080',
      'http://node2:8080',
      'http://node3:8080',
    ],
    discovery: 'enabled',
    dataDirectory,
  });
  const logger = silentLogger();
  let manager: FakeDiscoveryManager | undefined;
  const store = await seededStore();
  const transport = buildTestTransport(store, configuration);
  const syncAgent = buildTestSyncAgent(store, transport);
  cleanups.push(() => syncAgent.stop());
  const orchestrator = new RoleOrchestrator(configuration, logger, transport, {
    createDiscoveryManager: (config) => {
      manager = new FakeDiscoveryManager(config, fakeNodeInfo('id-node1'));
      return manager;
    },
  });
  cleanups.push(() => orchestrator.stop());
  const fetchStub = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('http://node2:8080')) {
      return Response.json({
        nodeName: 'node2',
        nodeId: 'id-node2',
        role: 'client',
        transport: { role: 'client', connectedToHub: true },
      });
    }
    throw new TypeError('fetch failed');
  }) as unknown as typeof globalThis.fetch;
  const directory = new NodeDirectory(configuration, logger, {
    fetch: fetchStub,
  });
  cleanups.push(() => directory.stop());
  const server = closing(
    buildServer({
      configuration,
      store,
      orchestrator,
      directory,
      syncAgent,
      logger,
    }),
  );
  await orchestrator.start();
  await directory.start();
  return {
    server,
    manager: () => {
      if (manager === undefined) {
        throw new Error('the orchestrator has not created its manager yet');
      }
      return manager;
    },
  };
};

describe('GET /status', () => {
  it('answers with the documented shape before the network components started', async () => {
    const server = closing(buildTestServer(await seededStore()));

    const response = await server.inject({ method: 'GET', url: '/status' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.json()).toStrictEqual({
      nodeName: 'node1',
      nodeId: null,
      publicUrl: 'http://localhost:8080',
      domain: 'petshop-test',
      role: 'starting',
      hubNodeId: null,
      hubAddress: null,
      peers: [],
      nodes: [
        {
          url: 'http://localhost:8080',
          self: true,
          name: 'node1',
          nodeId: null,
          role: 'starting',
          connectedClients: null,
          reachable: true,
          lastSeen: expect.any(String) as string,
          seenInTopology: true,
        },
      ],
      transport: { role: 'standalone', hubAddress: null, lastError: null },
      sync: {
        announced: 0,
        received: 0,
        skipped: 0,
        pending: 0,
        failed: 0,
        lastError: null,
        transfers: [],
      },
      storage: 'memory',
      seedSize: 'small',
      tables: expect.objectContaining({
        species: 3,
        speciesInsertHistory: 3,
        traits: 8,
        traitsInsertHistory: 8,
        animals: 10,
        animalsInsertHistory: 10,
      }) as Record<string, number>,
    });
    const tables = response.json<{ tables: Record<string, number> }>().tables;
    for (const table of expectedTables) {
      expect(tables[table]).toBeGreaterThan(0);
    }
    expect(
      Object.keys(response.json<{ tables: object }>().tables),
    ).toStrictEqual(expectedTables);
  });

  it('reports zero rows per table for an unseeded store', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    const server = closing(buildTestServer(store));

    const response = await server.inject({ method: 'GET', url: '/status' });

    expect(
      response.json<{ tables: Record<string, number> }>().tables,
    ).toStrictEqual(
      Object.fromEntries(expectedTables.map((table) => [table, 0])),
    );
  });

  it('reports the storage kind of the configuration', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'status-sqlite-'));
    cleanups.push(() =>
      rmSync(dataDirectory, { recursive: true, force: true }),
    );
    const store = await testStore({ storage: 'sqlite', dataDirectory });
    cleanups.push(() => store.close());
    const server = closing(
      buildTestServer(store, { storage: 'sqlite', dataDirectory }),
    );

    const response = await server.inject({ method: 'GET', url: '/status' });

    expect(response.json<{ storage: string }>().storage).toBe('sqlite');
  });

  it('reports the hub role, the transport, the peers with their names and every node of the environment', async () => {
    const { server, manager } = await serverOverFakeNetwork();
    manager().join(
      fakeNodeInfo('id-node2', { hostname: 'node2', localIps: ['172.18.0.3'] }),
    );
    manager().join(fakeNodeInfo('id-node4', { hostname: 'stranger' }));
    manager().elect('id-node1', '172.18.0.2:3000');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await server.inject({ method: 'GET', url: '/status' });
    const status = response.json<{
      role: string;
      hubNodeId: string;
      hubAddress: string;
      peers: { nodeId: string; name: string | null; role: string }[];
      nodes: {
        url: string;
        self: boolean;
        name: string | null;
        nodeId: string | null;
        role: string | null;
        connectedClients: number | null;
        reachable: boolean;
        seenInTopology: boolean;
      }[];
      transport: Record<string, unknown>;
    }>();

    expect(status).toMatchObject({
      nodeName: 'node1',
      nodeId: 'id-node1',
      publicUrl: 'http://node1:8080',
      role: 'hub',
      hubNodeId: 'id-node1',
      hubAddress: '172.18.0.2:3000',
      transport: {
        role: 'hub',
        hubAddress: '172.18.0.2:3000',
        connectedClients: 0,
        lastError: null,
      },
    });
    expect(status.peers).toHaveLength(2);
    expect(status.peers[0]).toMatchObject({
      nodeId: 'id-node2',
      name: 'node2',
      hostname: 'node2',
      addresses: ['172.18.0.3'],
      role: 'client',
    });
    expect(status.peers[1]).toMatchObject({
      nodeId: 'id-node4',
      name: null,
      role: 'client',
    });
    expect(status.nodes).toStrictEqual([
      {
        url: 'http://node1:8080',
        self: true,
        name: 'node1',
        nodeId: 'id-node1',
        role: 'hub',
        connectedClients: 0,
        reachable: true,
        lastSeen: expect.any(String) as string,
        seenInTopology: true,
      },
      {
        url: 'http://node2:8080',
        self: false,
        name: 'node2',
        nodeId: 'id-node2',
        role: 'client',
        connectedClients: null,
        reachable: true,
        lastSeen: expect.any(String) as string,
        seenInTopology: true,
      },
      {
        url: 'http://node3:8080',
        self: false,
        name: null,
        nodeId: null,
        role: null,
        connectedClients: null,
        reachable: false,
        lastSeen: null,
        seenInTopology: false,
      },
    ]);
  });
});
