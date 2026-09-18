import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Configuration } from '../configuration.ts';
import type { InsertEvent } from '../events/liveEvents.ts';
import { NodeDirectory } from '../network/nodeDirectory.ts';
import { RoleOrchestrator } from '../network/roleOrchestrator.ts';
import { SyncAgent, type SyncTransfer } from '../network/syncAgent.ts';
import { buildServer } from '../server.ts';
import { EventStreamReader } from '../testing/eventStreamReader.ts';
import {
  FakeDiscoveryManager,
  fakeNodeInfo,
} from '../testing/fakeDiscoveryManager.ts';
import { FakeChannel, FakeChannelSource } from '../testing/fakeSync.ts';
import {
  buildTestTransport,
  silentLogger,
  testConfiguration,
  testSyncAgentOptions,
} from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';
import type { TopologyReport } from './status.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * A node listening on an ephemeral port, its orchestrator over a fake
 * discovery manager the test steers, its sync agent over a fake channel
 * the test delivers announcements on, and short event stream timings.
 */
const listeningNode = async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'events-route-'));
  cleanups.push(() => rmSync(dataDirectory, { recursive: true, force: true }));
  const configuration: Configuration = Object.freeze({
    ...testConfiguration,
    discovery: 'enabled',
    dataDirectory,
  });
  const logger = silentLogger();
  const store = await memoryStore();
  cleanups.push(() => store.close());
  await store.seedIfEmpty();
  const transport = buildTestTransport(store, configuration);
  const channels = new FakeChannelSource();
  const syncAgent = new SyncAgent(
    store,
    channels,
    logger,
    testSyncAgentOptions,
  );
  syncAgent.start();
  cleanups.push(() => syncAgent.stop());
  let manager: FakeDiscoveryManager | undefined;
  const orchestrator = new RoleOrchestrator(configuration, logger, transport, {
    createDiscoveryManager: (config) => {
      manager = new FakeDiscoveryManager(config, fakeNodeInfo('id-self'));
      return manager;
    },
  });
  cleanups.push(() => orchestrator.stop());
  const server = buildServer({
    configuration,
    store,
    orchestrator,
    directory: new NodeDirectory(configuration, logger),
    syncAgent,
    logger,
    events: {
      heartbeatIntervalMs: 200,
      retryDelayMs: 1500,
      pollIntervalMs: 50,
    },
  });
  cleanups.push(() => server.close());
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const open = async (): Promise<EventStreamReader> => {
    const reader = await EventStreamReader.open(`${address}/api/events`);
    cleanups.push(() => reader.close());
    return reader;
  };
  return {
    server,
    address,
    store,
    orchestrator,
    channels,
    open,
    manager: (): FakeDiscoveryManager => {
      if (manager === undefined) {
        throw new Error('discovery has not started');
      }
      return manager;
    },
  };
};

describe('GET /api/events', () => {
  it('answers a stream with the headers a proxy must not buffer, a retry hint and a greeting', async () => {
    const node = await listeningNode();

    const reader = await node.open();

    expect(reader.response.status).toBe(200);
    expect(reader.response.headers.get('content-type')).toBe(
      'text/event-stream',
    );
    expect(reader.response.headers.get('cache-control')).toBe('no-cache');
    expect(reader.response.headers.get('x-accel-buffering')).toBe('no');
    expect(reader.response.headers.get('access-control-allow-origin')).toBe(
      '*',
    );
    expect(await reader.next((block) => block.retry !== null)).toMatchObject({
      retry: '1500',
    });
    expect(
      await reader.next((block) => block.comments.includes('connected')),
    ).toMatchObject({ event: null, data: null });
  });

  it('has no HEAD route, which would hold a client without a body', async () => {
    const node = await listeningNode();

    const response = await node.server.inject({
      method: 'HEAD',
      url: '/api/events',
    });

    expect(response.statusCode).toBe(404);
  });

  it('streams an insert event with the change set of an invoice issued on this node', async () => {
    const node = await listeningNode();
    const reader = await node.open();

    const issued = await node.server.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId: 'scrooge-mcduck',
        items: [{ animalId: 'donald-the-third', quantity: 2 }],
      },
    });
    expect(issued.statusCode).toBe(201);
    const invoice = issued.json<{ id: string; changeSetHash: string }>();

    const { id, payload } = await reader.nextEvent<InsertEvent>('insert');
    expect(id).toMatch(/^\d+$/);
    expect(payload).toStrictEqual({
      changeSetHash: invoice.changeSetHash,
      changeSetId: 'issue-invoice-2026-0007',
      tables: {
        invoices: 1,
        invoicesInsertHistory: 1,
        invoiceItems: 1,
        invoiceItemsInsertHistory: 1,
      },
      entityIds: [invoice.id, `${invoice.id}-item-1`],
    });
  });

  it('names the animal and its trait pairings in the insert event of an edit', async () => {
    const node = await listeningNode();
    const reader = await node.open();

    const edited = await node.server.inject({
      method: 'PUT',
      url: '/api/animals/bowser-the-guard-dog',
      payload: { name: 'Bowser the Retired Guard Dog' },
    });
    expect(edited.statusCode).toBe(200);

    const { payload } = await reader.nextEvent<InsertEvent>('insert');
    expect(payload.changeSetId).toMatch(/^update-animal-bowser-the-guard-dog-/);
    expect(payload.tables).toMatchObject({
      animals: 1,
      animalsInsertHistory: 1,
    });
    expect(payload.entityIds[0]).toBe('bowser-the-guard-dog');
    expect(payload.entityIds.slice(1)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^bowser-the-guard-dog--/),
      ]),
    );
  });

  it('streams a topology event when discovery starts and when the role changes', async () => {
    const node = await listeningNode();
    const reader = await node.open();

    await node.orchestrator.start();
    const started = await reader.nextEvent<TopologyReport>('topology');
    expect(started.payload).toMatchObject({
      nodeId: 'id-self',
      role: 'standalone',
      hubNodeId: null,
      peers: [],
      transport: { role: 'standalone' },
    });
    expect(started.payload.nodes).toMatchObject([
      { self: true, nodeId: 'id-self', role: 'standalone' },
    ]);

    node.manager().join(fakeNodeInfo('id-peer', { startedAt: 2_000 }));
    node.manager().elect('id-self', '10.0.0.7:3000');

    const elected = await reader.nextEvent<TopologyReport>(
      'topology',
      (topology) => topology.role === 'hub',
    );
    expect(elected.payload).toMatchObject({
      role: 'hub',
      hubNodeId: 'id-self',
      hubAddress: '10.0.0.7:3000',
      peers: [{ nodeId: 'id-peer', role: 'client' }],
    });
    expect(Number(elected.id)).toBeGreaterThan(Number(started.id));
  });

  it('streams a sync event when a pull starts and when it settles', async () => {
    const node = await listeningNode();
    const reader = await node.open();
    const channel = new FakeChannel('id-hub');
    node.channels.publish(channel);

    channel.deliver({
      changeSetHash: 'NoSuchChangeSetHash012',
      fromNodeId: 'id-writer',
    });

    const started = await reader.nextEvent<SyncTransfer>('sync');
    expect(started.payload).toStrictEqual({
      direction: 'incoming',
      peerNodeId: 'id-writer',
      changeSetHash: 'NoSuchChangeSetHash012',
      changeSetId: null,
      tables: {},
      durationMs: 0,
      at: expect.stringMatching(/Z$/) as string,
      status: 'pending',
    });
    const settled = await reader.nextEvent<SyncTransfer>(
      'sync',
      (transfer) => transfer.error !== undefined,
    );
    expect(settled.payload).toMatchObject({
      direction: 'incoming',
      peerNodeId: 'id-writer',
      changeSetHash: 'NoSuchChangeSetHash012',
      status: 'pending',
      error: expect.stringContaining('is not held by any node') as string,
    });
    const status = await node.server.inject({ method: 'GET', url: '/status' });
    expect(
      status.json<{ sync: { transfers: unknown[] } }>().sync.transfers,
    ).toHaveLength(1);
  });

  it('keeps the connection alive with heartbeat comments', async () => {
    const node = await listeningNode();
    const reader = await node.open();

    const heartbeat = await reader.next(
      (block) => block.comments.includes('heartbeat'),
      2_000,
    );

    expect(heartbeat).toMatchObject({ event: null, data: null });
  });

  it('serves several clients and lets one leave without disturbing the other', async () => {
    const node = await listeningNode();
    const leaving = await node.open();
    const staying = await node.open();
    await leaving.next((block) => block.comments.includes('connected'));
    await staying.next((block) => block.comments.includes('connected'));

    leaving.close();
    await node.server.inject({
      method: 'PUT',
      url: '/api/animals/pepper-the-poodle',
      payload: { priceCents: 12_345 },
    });

    const { payload } = await staying.nextEvent<InsertEvent>('insert');
    expect(payload.entityIds).toContain('pepper-the-poodle');
  });

  it('ends every open stream when the server closes, without waiting for the clients', async () => {
    const node = await listeningNode();
    const reader = await node.open();
    await reader.next((block) => block.comments.includes('connected'));

    const closing = performance.now();
    await node.server.close();

    await reader.untilClosed();
    expect(reader.error).toBeNull();
    expect(performance.now() - closing).toBeLessThan(2_000);
  });
});
