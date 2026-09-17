import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import { NodeDirectory } from './nodeDirectory.ts';

type FakeNode = {
  nodeName: string;
  nodeId: string;
  role: string;
};

const selfUrl = 'http://node1:8080';
const self = { name: 'node1', nodeId: 'id-node1', role: 'hub' as const };

/**
 * A `fetch` that answers `/status` for the nodes it knows and fails for
 * every other URL like an unreachable host would, while counting requests.
 */
const fakeFetch = (nodes: Record<string, FakeNode | 'broken' | 'slow'>) => {
  const requested: string[] = [];
  const fetchStub = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      const origin = url.replace(/\/status$/u, '');
      const node = nodes[origin];
      if (node === undefined) {
        throw new TypeError('fetch failed');
      }
      if (node === 'broken') {
        return new Response('{"statusCode":500}', { status: 500 });
      }
      if (node === 'slow') {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason as Error),
          );
        });
      }
      return Response.json(node);
    },
  ) as unknown as typeof globalThis.fetch;
  return { fetch: fetchStub, requested };
};

const directoryOver = (
  nodes: Record<string, FakeNode | 'broken' | 'slow'>,
  nodeUrls: readonly string[],
  options: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    nodeStatusUrls?: readonly string[];
  } = {},
) => {
  const { fetch, requested } = fakeFetch(nodes);
  const { logger, records } = recordingLogger();
  let now = 1_700_000_000_000;
  const { nodeStatusUrls = nodeUrls, ...directoryOptions } = options;
  const directory = new NodeDirectory(
    { publicUrl: selfUrl, nodeUrls, nodeStatusUrls },
    logger,
    { fetch, now: () => now, ...directoryOptions },
  );
  return {
    directory,
    requested,
    records,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
};

const started: NodeDirectory[] = [];
afterEach(() => {
  for (const directory of started.splice(0)) {
    directory.stop();
  }
  vi.useRealTimers();
});

describe('NodeDirectory', () => {
  it('lists only this node when NODE_URLS is empty, without fetching', async () => {
    const { directory, requested } = directoryOver({}, []);
    started.push(directory);

    await directory.start();

    expect(requested).toStrictEqual([]);
    expect(directory.entries(self, [])).toStrictEqual([
      {
        url: selfUrl,
        self: true,
        name: 'node1',
        nodeId: 'id-node1',
        role: 'hub',
        reachable: true,
        lastSeen: '2023-11-14T22:13:20.000Z',
        seenInTopology: true,
      },
    ]);
  });

  it('keeps the order of NODE_URLS and never fetches its own URL', async () => {
    const { directory, requested } = directoryOver(
      {
        'http://node2:8080': {
          nodeName: 'node2',
          nodeId: 'id-node2',
          role: 'client',
        },
        'http://node3:8080': {
          nodeName: 'node3',
          nodeId: 'id-node3',
          role: 'client',
        },
      },
      ['http://node3:8080', selfUrl, 'http://node2:8080'],
    );
    started.push(directory);

    await directory.start();

    expect(requested.sort()).toStrictEqual([
      'http://node2:8080/status',
      'http://node3:8080/status',
    ]);
    expect(directory.entries(self, []).map((entry) => entry.url)).toStrictEqual(
      ['http://node3:8080', selfUrl, 'http://node2:8080'],
    );
  });

  it('polls the status URL at the same position and keys the entry by the public URL', async () => {
    const { directory, requested, records } = directoryOver(
      {
        'http://node2.petshop.svc.cluster.local': {
          nodeName: 'node2',
          nodeId: 'id-node2',
          role: 'hub',
        },
        'http://node3.petshop.svc.cluster.local': {
          nodeName: 'node3',
          nodeId: 'id-node3',
          role: 'client',
        },
      },
      [selfUrl, 'https://node2.example.test', 'https://node3.example.test'],
      {
        nodeStatusUrls: [
          'http://node1.petshop.svc.cluster.local',
          'http://node2.petshop.svc.cluster.local',
          'http://node3.petshop.svc.cluster.local',
        ],
      },
    );
    started.push(directory);

    await directory.start();

    expect(requested.sort()).toStrictEqual([
      'http://node2.petshop.svc.cluster.local/status',
      'http://node3.petshop.svc.cluster.local/status',
    ]);
    expect(directory.entries(self, ['id-node2', 'id-node3'])).toMatchObject([
      { url: selfUrl, self: true },
      {
        url: 'https://node2.example.test',
        name: 'node2',
        nodeId: 'id-node2',
        role: 'hub',
        reachable: true,
        seenInTopology: true,
      },
      {
        url: 'https://node3.example.test',
        name: 'node3',
        nodeId: 'id-node3',
        role: 'client',
        reachable: true,
        seenInTopology: true,
      },
    ]);
    expect(records).toContainEqual(
      expect.objectContaining({
        message: 'node reachable',
        fields: {
          url: 'https://node2.example.test',
          statusUrl: 'http://node2.petshop.svc.cluster.local',
          nodeId: 'id-node2',
        },
      }),
    );
  });

  it('puts this node first when NODE_URLS does not list it', () => {
    const { directory } = directoryOver({}, ['http://node2:8080']);

    expect(directory.entries(self, []).map((entry) => entry.url)).toStrictEqual(
      [selfUrl, 'http://node2:8080'],
    );
  });

  it('correlates names, node ids and roles with the discovery topology', async () => {
    const { directory, records } = directoryOver(
      {
        'http://node2:8080': {
          nodeName: 'node2',
          nodeId: 'id-node2',
          role: 'client',
        },
        'http://node3:8080': {
          nodeName: 'node3',
          nodeId: 'id-node3',
          role: 'starting',
        },
      },
      [selfUrl, 'http://node2:8080', 'http://node3:8080'],
    );
    started.push(directory);

    await directory.start();
    const entries = directory.entries(self, ['id-node2']);

    expect(entries[1]).toStrictEqual({
      url: 'http://node2:8080',
      self: false,
      name: 'node2',
      nodeId: 'id-node2',
      role: 'client',
      reachable: true,
      lastSeen: '2023-11-14T22:13:20.000Z',
      seenInTopology: true,
    });
    expect(entries[2]).toMatchObject({
      name: 'node3',
      nodeId: 'id-node3',
      role: 'starting',
      reachable: true,
      seenInTopology: false,
    });
    expect(directory.nameOf('id-node3')).toBe('node3');
    expect(directory.nameOf('id-unknown')).toBeNull();
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'node reachable',
        fields: {
          url: 'http://node2:8080',
          statusUrl: 'http://node2:8080',
          nodeId: 'id-node2',
        },
      }),
    );
  });

  it('marks a node unreachable when it fails, answers an error or times out', async () => {
    const { directory } = directoryOver(
      { 'http://node3:8080': 'broken', 'http://node4:8080': 'slow' },
      ['http://node2:8080', 'http://node3:8080', 'http://node4:8080'],
      { timeoutMs: 20 },
    );
    started.push(directory);

    await directory.start();

    for (const entry of directory.entries(self, []).slice(1)) {
      expect(entry).toMatchObject({
        name: null,
        nodeId: null,
        role: null,
        reachable: false,
        lastSeen: null,
        seenInTopology: false,
      });
    }
  });

  it('keeps the last known identity of a node that became unreachable', async () => {
    const nodes: Record<string, FakeNode | 'broken'> = {
      'http://node2:8080': {
        nodeName: 'node2',
        nodeId: 'id-node2',
        role: 'client',
      },
    };
    const { directory, records, advance } = directoryOver(
      nodes,
      ['http://node2:8080'],
      { pollIntervalMs: 1_000 },
    );
    started.push(directory);
    vi.useFakeTimers();
    await directory.start();

    nodes['http://node2:8080'] = 'broken';
    advance(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(directory.entries(self, ['id-node2'])[1]).toMatchObject({
      name: 'node2',
      nodeId: 'id-node2',
      reachable: false,
      lastSeen: '2023-11-14T22:13:20.000Z',
      seenInTopology: true,
    });
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'node unreachable',
      }),
    );
  });

  it('treats a status without usable fields as unknown', async () => {
    const { directory } = directoryOver(
      {
        'http://node2:8080': {
          nodeName: '',
          nodeId: 42 as unknown as string,
          role: 'president',
        },
      },
      ['http://node2:8080'],
    );
    started.push(directory);

    await directory.start();

    expect(directory.entries(self, [])[1]).toMatchObject({
      name: null,
      nodeId: null,
      role: null,
      reachable: true,
    });
  });

  it('polls again after the interval and stops polling once stopped', async () => {
    const { directory, requested } = directoryOver(
      {
        'http://node2:8080': {
          nodeName: 'node2',
          nodeId: 'id-node2',
          role: 'client',
        },
      },
      ['http://node2:8080'],
      { pollIntervalMs: 1_000 },
    );
    vi.useFakeTimers();

    await directory.start();
    await directory.start();
    expect(requested).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requested).toHaveLength(2);
    directory.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(requested).toHaveLength(2);
  });
});
