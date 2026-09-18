import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { SyncAgent, type SyncTransfer } from '../network/syncAgent.ts';
import {
  FakeChannel,
  FakeChannelSource,
  FakeSyncStore,
} from '../testing/fakeSync.ts';
import { buildTestServer, silentLogger } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * A server whose sync agent runs over a fake store and a fake channel, so
 * that the test writes the transfers the route lists: as the hub, twelve
 * announcements to every client; as a client of `hub-node`, one more.
 */
const serverWithTransfers = async (): Promise<FastifyInstance> => {
  const fakeStore = new FakeSyncStore();
  const channels = new FakeChannelSource();
  const agent = new SyncAgent(fakeStore, channels, silentLogger());
  agent.start();
  cleanups.push(() => agent.stop());
  channels.publish(new FakeChannel(null));
  for (let index = 1; index <= 12; index += 1) {
    fakeStore.writeOwnChangeSet(`broadcast-${index}`, [
      { table: 'invoices', ref: `invoice-${index}` },
    ]);
  }
  channels.publish(new FakeChannel('hub-node'));
  fakeStore.writeOwnChangeSet('to-the-hub', []);

  const store = await memoryStore();
  cleanups.push(() => store.close());
  const server = buildTestServer(store, {}, undefined, agent);
  cleanups.push(() => server.close());
  return server;
};

describe('GET /api/sync/transfers', () => {
  it('lists the last ten transfers newest first, cross-origin readable', async () => {
    const server = await serverWithTransfers();

    const response = await server.inject({
      method: 'GET',
      url: '/api/sync/transfers',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    const transfers = response.json<SyncTransfer[]>();
    expect(transfers.map((transfer) => transfer.changeSetId)).toStrictEqual([
      'to-the-hub',
      'broadcast-12',
      'broadcast-11',
      'broadcast-10',
      'broadcast-9',
      'broadcast-8',
      'broadcast-7',
      'broadcast-6',
      'broadcast-5',
      'broadcast-4',
    ]);
    expect(transfers[1]).toStrictEqual({
      direction: 'outgoing',
      peerNodeId: null,
      changeSetHash: expect.any(String),
      changeSetId: 'broadcast-12',
      tables: { invoices: 1 },
      durationMs: 0,
      at: expect.any(String),
      status: 'completed',
    });
  });

  it('lists the transfers with one partner and honours the limit', async () => {
    const server = await serverWithTransfers();

    const withHub = await server.inject({
      method: 'GET',
      url: '/api/sync/transfers?peer=hub-node&limit=2',
    });
    const withClient = await server.inject({
      method: 'GET',
      url: '/api/sync/transfers?peer=client-a&limit=50',
    });
    const withNobody = await server.inject({
      method: 'GET',
      url: '/api/sync/transfers?peer=&limit=50',
    });

    expect(
      withHub.json<SyncTransfer[]>().map((transfer) => transfer.changeSetId),
    ).toStrictEqual(['to-the-hub', 'broadcast-12']);
    expect(
      withClient.json<SyncTransfer[]>().map((transfer) => transfer.changeSetId),
    ).toStrictEqual(
      Array.from({ length: 12 }, (_, index) => `broadcast-${12 - index}`),
    );
    expect(withNobody.json<SyncTransfer[]>()).toHaveLength(13);
  });

  it.each(['0', '51', 'ten', '', '1.5'])(
    'refuses limit "%s" with 400',
    async (limit) => {
      const server = await serverWithTransfers();

      const response = await server.inject({
        method: 'GET',
        url: `/api/sync/transfers?limit=${limit}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toStrictEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: `limit must be a whole number from 1 to 50, got "${limit}".`,
      });
    },
  );

  it('answers an empty list for a node that transferred nothing', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    const server = buildTestServer(store);
    cleanups.push(() => server.close());

    const response = await server.inject({
      method: 'GET',
      url: '/api/sync/transfers?peer=anyone',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });
});
