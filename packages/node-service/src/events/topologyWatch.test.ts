import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NetworkSnapshot } from '../network/roleOrchestrator.ts';
import type { StatusNode, TopologyReport } from '../routes/status.ts';
import { TopologyWatch, topologyFingerprint } from './topologyWatch.ts';

const standalone: NetworkSnapshot = {
  nodeId: 'id-node1',
  identity: {
    persistent: false,
    startedAt: '2026-09-18T09:59:00.000Z',
    identityPath: null,
  },
  role: 'standalone',
  domain: 'petshop-test',
  hubNodeId: null,
  hubAddress: null,
  peers: [],
  transport: { role: 'standalone', hubAddress: null, lastError: null },
};

const peer = (lastSeen: string, latencyMs: number) => ({
  nodeId: 'id-node2',
  hostname: 'node2',
  addresses: ['10.0.0.2'],
  port: 3000,
  role: 'hub' as const,
  startedAt: '2026-09-18T10:00:00.000Z',
  firstSeen: '2026-09-18T10:00:01.000Z',
  lastSeen,
  probe: { reachable: true, latencyMs, measuredAt: lastSeen },
  excludedFromElection: false,
});

const asClient = (lastSeen: string, latencyMs: number): NetworkSnapshot => ({
  ...standalone,
  role: 'client',
  hubNodeId: 'id-node2',
  hubAddress: '10.0.0.2:3000',
  peers: [peer(lastSeen, latencyMs)],
  transport: {
    role: 'client',
    hubAddress: '10.0.0.2:3000',
    connectedToHub: true,
    lastError: null,
  },
});

const selfEntry = (lastSeen: string): StatusNode => ({
  url: 'http://node1:8080',
  self: true,
  name: 'node1',
  nodeId: 'id-node1',
  role: 'standalone',
  connectedClients: null,
  identity: null,
  reachable: true,
  lastSeen,
  seenInTopology: true,
});

/**
 * A watch over sources a test steers directly: the snapshot the
 * orchestrator would answer and the entries the directory would list.
 */
const watchOver = (pollIntervalMs = 1000) => {
  let snapshot = standalone;
  let entries = [selfEntry('2026-09-18T10:00:00.000Z')];
  const published: TopologyReport[] = [];
  const watch = new TopologyWatch(
    {
      configuration: { nodeName: 'node1' },
      orchestrator: { snapshot: () => snapshot },
      directory: { entries: () => entries, nameOf: () => 'node2' },
    },
    (topology) => published.push(topology),
    { pollIntervalMs },
  );
  return {
    watch,
    published,
    set: (next: NetworkSnapshot, nextEntries = entries) => {
      snapshot = next;
      entries = nextEntries;
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('topologyFingerprint', () => {
  it('ignores the timestamps and latencies that advance on their own', () => {
    const report = (lastSeen: string, latencyMs: number): TopologyReport => ({
      nodeId: 'id-node1',
      identity: standalone.identity,
      role: 'client',
      hubNodeId: 'id-node2',
      hubAddress: '10.0.0.2:3000',
      peers: [{ ...peer(lastSeen, latencyMs), name: 'node2' }],
      nodes: [selfEntry(lastSeen)],
      transport: {
        role: 'client',
        hubAddress: '10.0.0.2:3000',
        connectedToHub: true,
        lastError: null,
      },
    });

    expect(topologyFingerprint(report('2026-09-18T10:00:00.000Z', 1))).toBe(
      topologyFingerprint(report('2026-09-18T10:05:00.000Z', 2)),
    );
    expect(
      topologyFingerprint({
        ...report('2026-09-18T10:00:00.000Z', 1),
        role: 'hub',
      }),
    ).not.toBe(topologyFingerprint(report('2026-09-18T10:00:00.000Z', 1)));
  });

  it('counts a probe that starts failing as a change', () => {
    const reachable = {
      ...peer('2026-09-18T10:00:00.000Z', 1),
      name: 'node2',
    };
    const failing = {
      ...reachable,
      probe: { ...reachable.probe, reachable: false },
    };
    const report = (entry: typeof reachable): TopologyReport => ({
      ...standalone,
      peers: [entry],
      nodes: [],
    });

    expect(topologyFingerprint(report(reachable))).not.toBe(
      topologyFingerprint(report(failing)),
    );
  });
});

describe('TopologyWatch', () => {
  it('does nothing before start and publishes nothing for an unchanged report', () => {
    vi.useFakeTimers();
    const { watch, published } = watchOver();

    watch.check();
    watch.start();
    watch.check();
    vi.advanceTimersByTime(3000);

    expect(published).toStrictEqual([]);
  });

  it('publishes the report when a check finds a change', () => {
    vi.useFakeTimers();
    const { watch, published, set } = watchOver();
    watch.start();

    set(asClient('2026-09-18T10:00:05.000Z', 1));
    watch.check();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      nodeId: 'id-node1',
      role: 'client',
      hubNodeId: 'id-node2',
      hubAddress: '10.0.0.2:3000',
      peers: [{ nodeId: 'id-node2', name: 'node2', role: 'hub' }],
      nodes: [{ url: 'http://node1:8080', self: true }],
      transport: { role: 'client', connectedToHub: true },
    });
  });

  it('stays quiet while only last seen times and latencies advance', () => {
    vi.useFakeTimers();
    const { watch, published, set } = watchOver();
    set(asClient('2026-09-18T10:00:05.000Z', 1));
    watch.start();

    set(asClient('2026-09-18T10:00:15.000Z', 2), [
      selfEntry('2026-09-18T10:00:15.000Z'),
    ]);
    watch.check();
    vi.advanceTimersByTime(5000);

    expect(published).toStrictEqual([]);
  });

  it('catches a change nobody reported on the next poll and stops with stop', () => {
    vi.useFakeTimers();
    const { watch, published, set } = watchOver(500);
    set(asClient('2026-09-18T10:00:05.000Z', 1));
    watch.start();

    set({
      ...asClient('2026-09-18T10:00:05.000Z', 1),
      transport: {
        role: 'client',
        hubAddress: '10.0.0.2:3000',
        connectedToHub: false,
        lastError: 'disconnected from hub 10.0.0.2:3000: transport close',
      },
    });
    vi.advanceTimersByTime(499);
    expect(published).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.transport).toMatchObject({ connectedToHub: false });

    watch.stop();
    set(standalone);
    vi.advanceTimersByTime(2000);
    watch.check();

    expect(published).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
