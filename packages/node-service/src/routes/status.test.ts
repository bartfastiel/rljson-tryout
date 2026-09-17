import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Configuration } from '../configuration.ts';
import { NodeDirectory } from '../network/nodeDirectory.ts';
import { RoleOrchestrator } from '../network/roleOrchestrator.ts';
import { buildServer } from '../server.ts';
import { PetShopStore } from '../store/petShopStore.ts';
import {
  FakeDiscoveryManager,
  fakeNodeInfo,
} from '../testing/fakeDiscoveryManager.ts';
import {
  buildTestServer,
  silentLogger,
  testConfiguration,
} from '../testing/testServer.ts';

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
];

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const seededStore = async (): Promise<PetShopStore> => {
  const store = new PetShopStore();
  await store.initialize();
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
    discovery: 'enabled',
    dataDirectory,
  });
  const logger = silentLogger();
  let manager: FakeDiscoveryManager | undefined;
  const orchestrator = new RoleOrchestrator(configuration, logger, {
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
      });
    }
    throw new TypeError('fetch failed');
  }) as unknown as typeof globalThis.fetch;
  const directory = new NodeDirectory(configuration, logger, {
    fetch: fetchStub,
  });
  cleanups.push(() => directory.stop());
  const store = await seededStore();
  const server = closing(
    buildServer({ configuration, store, orchestrator, directory, logger }),
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
          reachable: true,
          lastSeen: expect.any(String) as string,
          seenInTopology: true,
        },
      ],
      storage: 'memory',
      tables: {
        species: 3,
        speciesInsertHistory: 3,
        traits: 8,
        traitsInsertHistory: 8,
        persons: 6,
        personsInsertHistory: 6,
        breeders: 4,
        breedersInsertHistory: 4,
        animals: 10,
        animalsInsertHistory: 10,
        animalTraits: expect.any(Number) as number,
        animalTraitsInsertHistory: expect.any(Number) as number,
      },
    });
    expect(
      Object.keys(response.json<{ tables: object }>().tables),
    ).toStrictEqual(expectedTables);
  });

  it('reports zero rows per table for an unseeded store', async () => {
    const store = new PetShopStore();
    await store.initialize();
    cleanups.push(() => store.close());
    const server = closing(buildTestServer(store));

    const response = await server.inject({ method: 'GET', url: '/status' });

    expect(
      response.json<{ tables: Record<string, number> }>().tables,
    ).toStrictEqual(
      Object.fromEntries(expectedTables.map((table) => [table, 0])),
    );
  });

  it('reports the hub role, the peers with their names and every node of the environment', async () => {
    const { server, manager } = await serverOverFakeNetwork();
    manager().join(
      fakeNodeInfo('id-node2', { hostname: 'node2', localIps: ['172.18.0.3'] }),
    );
    manager().join(fakeNodeInfo('id-node4', { hostname: 'stranger' }));
    manager().elect('id-node1', '172.18.0.2:3000');

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
        reachable: boolean;
        seenInTopology: boolean;
      }[];
    }>();

    expect(status).toMatchObject({
      nodeName: 'node1',
      nodeId: 'id-node1',
      publicUrl: 'http://node1:8080',
      role: 'hub',
      hubNodeId: 'id-node1',
      hubAddress: '172.18.0.2:3000',
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
        reachable: false,
        lastSeen: null,
        seenInTopology: false,
      },
    ]);
  });
});
