import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import type { NodeReport } from './nodeDirectory.ts';
import type { PeerSnapshot } from './roleOrchestrator.ts';
import {
  TopologyRepair,
  type TopologyRepairOptions,
} from './topologyRepair.ts';

const selfNodeId = 'id-self';

const peer = (
  nodeId: string,
  startedAt: string,
  role: PeerSnapshot['role'] = 'client',
): PeerSnapshot => ({
  nodeId,
  hostname: nodeId,
  addresses: ['10.0.0.2'],
  port: 3000,
  role,
  startedAt,
  firstSeen: '2026-09-18T10:00:00.000Z',
  lastSeen: '2026-09-18T10:00:00.000Z',
  probe: {
    reachable: true,
    latencyMs: 1,
    measuredAt: '2026-09-18T10:00:00.000Z',
  },
  excludedFromElection: false,
});

const report = (
  nodeId: string,
  startedAt: string | null,
  role: NodeReport['role'] = 'client',
): NodeReport => ({ nodeId, role, startedAt });

/**
 * A repair over sources the test steers: the peers and hub the
 * orchestrator would report, the reports the directory would hold, a
 * clock the test advances, and a record of every exclusion.
 */
const repairOver = (options: TopologyRepairOptions = {}) => {
  let now = 1_700_000_000_000;
  let nodeId: string | null = selfNodeId;
  let hubNodeId: string | null = null;
  let peers: PeerSnapshot[] = [];
  let reports: NodeReport[] = [];
  const exclusions: { nodeId: string; durationMs: number; at: number }[] = [];
  const { logger, records } = recordingLogger();
  const repair = new TopologyRepair(
    {
      network: () => ({ nodeId, hubNodeId, peers }),
      reports: () => reports,
      excludeFromElection: (excluded, durationMs) => {
        exclusions.push({ nodeId: excluded, durationMs, at: now });
      },
    },
    logger,
    { now: () => now, ...options },
  );
  return {
    repair,
    exclusions,
    records,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    set: (
      next: Partial<{
        nodeId: string | null;
        hubNodeId: string | null;
        peers: PeerSnapshot[];
        reports: NodeReport[];
      }>,
    ) => {
      nodeId = next.nodeId === undefined ? nodeId : next.nodeId;
      hubNodeId = next.hubNodeId === undefined ? hubNodeId : next.hubNodeId;
      peers = next.peers ?? peers;
      reports = next.reports ?? reports;
    },
  };
};

const oldStart = '2026-09-18T10:00:00.000Z';
const newStart = '2026-09-18T10:05:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

describe('TopologyRepair on a restarted peer', () => {
  it('excludes a peer whose reported start time differs once the grace period passed', () => {
    const { repair, exclusions, records, advance, set } = repairOver();
    set({
      hubNodeId: 'id-hub',
      peers: [peer('id-hub', oldStart, 'hub'), peer('id-other', oldStart)],
      reports: [
        report('id-hub', newStart, 'client'),
        report('id-other', oldStart),
      ],
    });

    repair.check();
    advance(4_999);
    repair.check();
    expect(exclusions).toStrictEqual([]);
    advance(1);
    repair.check();

    expect(exclusions).toStrictEqual([
      { nodeId: 'id-hub', durationMs: 90_000, at: 1_700_000_005_000 },
    ]);
    expect(records).toContainEqual({
      level: 'warn',
      message: 'peer excluded from the hub election',
      fields: {
        nodeId: 'id-hub',
        cause: 'peer-restarted',
        knownStartedAt: oldStart,
        reportedStartedAt: newStart,
        observedForMs: 5_000,
        excludedForMs: 90_000,
      },
    });
  });

  it('leaves a peer alone whose start time matches or who reports none', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      peers: [peer('id-same', oldStart), peer('id-silent', oldStart)],
      reports: [report('id-same', oldStart), report('id-silent', null)],
    });

    for (let round = 0; round < 20; round += 1) {
      repair.check();
      advance(1_000);
    }

    expect(exclusions).toStrictEqual([]);
  });

  it('ignores a peer that no reachable node reports', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({ peers: [peer('id-gone', oldStart)], reports: [] });

    repair.check();
    advance(60_000);
    repair.check();

    expect(exclusions).toStrictEqual([]);
  });

  it('starts the grace period over when the difference disappears in between', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      peers: [peer('id-peer', oldStart)],
      reports: [report('id-peer', newStart)],
    });

    repair.check();
    advance(3_000);
    set({ reports: [report('id-peer', oldStart)] });
    repair.check();
    advance(3_000);
    set({ reports: [report('id-peer', newStart)] });
    repair.check();
    advance(3_000);
    repair.check();
    expect(exclusions).toStrictEqual([]);
    advance(2_000);
    repair.check();

    expect(exclusions).toHaveLength(1);
  });

  it('renews the exclusion once per interval while the difference persists', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      peers: [peer('id-peer', oldStart)],
      reports: [report('id-peer', newStart)],
    });

    for (let second = 0; second <= 130; second += 1) {
      repair.check();
      advance(1_000);
    }

    expect(exclusions.map((exclusion) => exclusion.at)).toStrictEqual([
      1_700_000_005_000, 1_700_000_065_000, 1_700_000_125_000,
    ]);
  });

  it('does not exclude before the network has an id', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      nodeId: null,
      peers: [peer('id-peer', oldStart)],
      reports: [report('id-peer', newStart)],
    });

    repair.check();
    advance(10_000);
    repair.check();

    expect(exclusions).toStrictEqual([]);
  });
});

describe('TopologyRepair on a hub that denies its role', () => {
  it('excludes the followed hub after it reported another role for the grace period', () => {
    const { repair, exclusions, records, advance, set } = repairOver();
    set({
      hubNodeId: 'id-hub',
      peers: [peer('id-hub', oldStart, 'hub')],
      reports: [report('id-hub', null, 'client')],
    });

    repair.check();
    advance(9_999);
    repair.check();
    expect(exclusions).toStrictEqual([]);
    advance(1);
    repair.check();

    expect(exclusions).toStrictEqual([
      { nodeId: 'id-hub', durationMs: 90_000, at: 1_700_000_010_000 },
    ]);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({
          nodeId: 'id-hub',
          cause: 'hub-denies-role',
          reportedRole: 'client',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('accepts a hub that reports the hub role, an unknown role, or is this node', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      hubNodeId: 'id-hub',
      peers: [peer('id-hub', oldStart, 'hub')],
      reports: [report('id-hub', oldStart, 'hub')],
    });
    repair.check();
    advance(20_000);
    repair.check();
    set({ reports: [report('id-hub', oldStart, null)] });
    repair.check();
    advance(20_000);
    repair.check();
    set({
      hubNodeId: selfNodeId,
      peers: [peer('id-hub', oldStart, 'client')],
      reports: [report('id-hub', oldStart, 'client')],
    });
    repair.check();
    advance(20_000);
    repair.check();

    expect(exclusions).toStrictEqual([]);
  });

  it('excludes a restarted hub for both causes at most once per interval each', () => {
    const { repair, exclusions, advance, set } = repairOver();
    set({
      hubNodeId: 'id-hub',
      peers: [peer('id-hub', oldStart, 'hub')],
      reports: [report('id-hub', newStart, 'client')],
    });

    for (let second = 0; second <= 30; second += 1) {
      repair.check();
      advance(1_000);
    }

    expect(exclusions).toStrictEqual([
      { nodeId: 'id-hub', durationMs: 90_000, at: 1_700_000_005_000 },
      { nodeId: 'id-hub', durationMs: 90_000, at: 1_700_000_010_000 },
    ]);
  });

  it('bounds a condition that comes and goes to one repair per interval', () => {
    const { repair, exclusions, advance, set } = repairOver();
    const denying = {
      hubNodeId: 'id-hub',
      peers: [peer('id-hub', oldStart, 'hub')],
      reports: [report('id-hub', null, 'client')],
    };
    const agreeing = { ...denying, reports: [report('id-hub', null, 'hub')] };

    set(denying);
    for (let second = 0; second <= 10; second += 1) {
      repair.check();
      advance(1_000);
    }
    set(agreeing);
    repair.check();
    advance(1_000);
    set(denying);
    for (let second = 0; second <= 10; second += 1) {
      repair.check();
      advance(1_000);
    }
    expect(exclusions).toHaveLength(1);
    advance(46_000);
    repair.check();
    expect(exclusions).toHaveLength(1);
    advance(1_000);
    repair.check();

    expect(exclusions.map((exclusion) => exclusion.at)).toStrictEqual([
      1_700_000_010_000, 1_700_000_070_000,
    ]);
  });
});

describe('TopologyRepair timer', () => {
  it('checks every interval after start and forgets everything on stop', () => {
    vi.useFakeTimers();
    const { repair, exclusions, advance, set } = repairOver({
      checkIntervalMs: 500,
      restartGraceMs: 1_000,
    });
    set({
      peers: [peer('id-peer', oldStart)],
      reports: [report('id-peer', newStart)],
    });

    repair.start();
    repair.start();
    for (let tick = 0; tick < 3; tick += 1) {
      advance(500);
      vi.advanceTimersByTime(500);
    }
    expect(exclusions).toHaveLength(1);
    repair.stop();
    advance(60_000);
    vi.advanceTimersByTime(60_000);
    expect(exclusions).toHaveLength(1);

    repair.start();
    advance(500);
    vi.advanceTimersByTime(500);
    expect(exclusions).toHaveLength(1);
    advance(1_000);
    vi.advanceTimersByTime(1_000);

    expect(exclusions).toHaveLength(2);
    repair.stop();
  });
});
