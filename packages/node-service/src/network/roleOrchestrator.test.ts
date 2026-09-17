import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NetworkConfig } from '@rljson/network';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FakeDiscoveryManager,
  fakeNodeInfo,
} from '../testing/fakeDiscoveryManager.ts';
import { recordingLogger } from '../testing/recordingLogger.ts';
import { HubPortListener } from './hubPortListener.ts';
import {
  RoleOrchestrator,
  type RoleOrchestratorConfiguration,
} from './roleOrchestrator.ts';

const selfNodeId = 'aaaaaaaa-self';
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'role-orchestrator-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const configuration = (
  overrides: Partial<RoleOrchestratorConfiguration> = {},
): RoleOrchestratorConfiguration => ({
  rljsonDomain: 'petshop-test',
  hubPort: 0,
  broadcastPort: 0,
  dataDirectory: temporaryDirectory(),
  discovery: 'enabled',
  ...overrides,
});

/**
 * An orchestrator over a fake manager, with a clock the test advances and a
 * real `HubPortListener` on port 0 so that the hub port handling is
 * exercised without a fixed port.
 */
const orchestratorOverFake = (
  overrides: Partial<RoleOrchestratorConfiguration> = {},
) => {
  let manager: FakeDiscoveryManager | undefined;
  let now = 1_700_000_000_000;
  const { logger, records } = recordingLogger();
  const hubPortListener = new HubPortListener();
  const orchestrator = new RoleOrchestrator(configuration(overrides), logger, {
    createDiscoveryManager: (config: NetworkConfig) => {
      manager = new FakeDiscoveryManager(
        config,
        fakeNodeInfo(selfNodeId, { startedAt: 500 }),
      );
      return manager;
    },
    hubPortListener,
    now: () => now,
  });
  return {
    orchestrator,
    records,
    hubPortListener,
    manager: () => {
      if (manager === undefined) {
        throw new Error('the orchestrator has not created its manager yet');
      }
      return manager;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('RoleOrchestrator before start', () => {
  it('reports the role starting without a node id', () => {
    const { orchestrator } = orchestratorOverFake();

    expect(orchestrator.snapshot()).toStrictEqual({
      nodeId: null,
      role: 'starting',
      domain: 'petshop-test',
      hubNodeId: null,
      hubAddress: null,
      peers: [],
    });
  });
});

describe('RoleOrchestrator with discovery disabled', () => {
  it('runs standalone with a fresh node id and no manager', async () => {
    const { orchestrator, records } = orchestratorOverFake({
      discovery: 'disabled',
    });

    await orchestrator.start();
    const snapshot = orchestrator.snapshot();

    expect(snapshot.role).toBe('standalone');
    expect(snapshot.nodeId).toMatch(uuidPattern);
    expect(snapshot.peers).toStrictEqual([]);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'discovery disabled, running standalone',
      }),
    );
    await orchestrator.stop();
  });

  it('does not create the identity directory', async () => {
    const dataDirectory = temporaryDirectory();
    const { orchestrator } = orchestratorOverFake({
      discovery: 'disabled',
      dataDirectory,
    });

    await orchestrator.start();

    expect(existsSync(join(dataDirectory, 'identity'))).toBe(false);
  });
});

describe('RoleOrchestrator with discovery enabled', () => {
  it('starts the manager with the configured domain, ports and identity directory', async () => {
    const dataDirectory = temporaryDirectory();
    const { orchestrator, manager } = orchestratorOverFake({
      rljsonDomain: 'petshop-compose',
      hubPort: 3100,
      broadcastPort: 41300,
      dataDirectory,
    });

    await orchestrator.start();

    expect(manager().started).toBe(true);
    expect(manager().config).toStrictEqual({
      domain: 'petshop-compose',
      port: 3100,
      identityDir: join(dataDirectory, 'identity'),
      broadcast: { enabled: true, port: 41300 },
      probing: { enabled: true },
    });
    expect(existsSync(join(dataDirectory, 'identity'))).toBe(true);
    await orchestrator.stop();
  });

  it('is standalone while unassigned without peers', async () => {
    const { orchestrator, records } = orchestratorOverFake();

    await orchestrator.start();

    expect(orchestrator.snapshot()).toMatchObject({
      nodeId: selfNodeId,
      role: 'standalone',
      hubNodeId: null,
      hubAddress: null,
      peers: [],
    });
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'discovery started',
        fields: expect.objectContaining({
          nodeId: selfNodeId,
          domain: 'petshop-test',
        }) as Record<string, unknown>,
      }),
    );
    await orchestrator.stop();
  });

  it('is starting while peers are known but no hub is elected yet', async () => {
    const { orchestrator, manager } = orchestratorOverFake();
    await orchestrator.start();

    manager().join(fakeNodeInfo('bbbbbbbb-peer'));

    expect(orchestrator.snapshot().role).toBe('starting');
    await orchestrator.stop();
  });

  it('lists a joined peer with its addresses, port and seen times', async () => {
    const { orchestrator, manager, advance } = orchestratorOverFake();
    await orchestrator.start();

    manager().join(
      fakeNodeInfo('bbbbbbbb-peer', {
        hostname: 'node2',
        localIps: ['172.18.0.3'],
        port: 3000,
        startedAt: 1_700_000_000_000,
      }),
    );
    advance(10_000);
    manager().emit('topology-changed', { topology: manager().topology });

    expect(orchestrator.snapshot().peers).toStrictEqual([
      {
        nodeId: 'bbbbbbbb-peer',
        hostname: 'node2',
        addresses: ['172.18.0.3'],
        port: 3000,
        role: null,
        startedAt: '2023-11-14T22:13:20.000Z',
        firstSeen: '2023-11-14T22:13:20.000Z',
        lastSeen: '2023-11-14T22:13:30.000Z',
        probe: null,
      },
    ]);
    await orchestrator.stop();
  });

  it('forgets a peer that left', async () => {
    const { orchestrator, manager, records } = orchestratorOverFake();
    await orchestrator.start();
    manager().join(fakeNodeInfo('bbbbbbbb-peer'));

    manager().leave('bbbbbbbb-peer');

    expect(orchestrator.snapshot()).toMatchObject({
      role: 'standalone',
      peers: [],
    });
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'peer left',
        fields: { nodeId: 'bbbbbbbb-peer' },
      }),
    );
    await orchestrator.stop();
  });

  it('becomes the hub, binds the hub port and marks the peers as clients', async () => {
    const { orchestrator, manager, hubPortListener, records } =
      orchestratorOverFake();
    await orchestrator.start();
    manager().join(fakeNodeInfo('bbbbbbbb-peer'));
    manager().join(fakeNodeInfo('cccccccc-peer'));

    manager().elect(selfNodeId, '10.0.0.13:3000');
    await settle();

    expect(orchestrator.snapshot()).toMatchObject({
      role: 'hub',
      hubNodeId: selfNodeId,
      hubAddress: '10.0.0.13:3000',
    });
    expect(
      orchestrator.snapshot().peers.map((peer) => peer.role),
    ).toStrictEqual(['client', 'client']);
    expect(hubPortListener.isListening()).toBe(true);
    expect(records).toContainEqual(
      expect.objectContaining({
        message: 'role changed',
        fields: { previous: 'unassigned', current: 'hub' },
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ message: 'hub port bound' }),
    );
    await orchestrator.stop();
    expect(hubPortListener.isListening()).toBe(false);
  });

  it('becomes a client of another hub and releases the hub port again', async () => {
    const { orchestrator, manager, hubPortListener, records } =
      orchestratorOverFake();
    await orchestrator.start();
    manager().join(fakeNodeInfo('bbbbbbbb-peer'));
    manager().elect(selfNodeId, '10.0.0.13:3000');
    await settle();
    expect(hubPortListener.isListening()).toBe(true);

    manager().elect('bbbbbbbb-peer', '10.0.0.13:3000');
    await settle();

    expect(orchestrator.snapshot()).toMatchObject({
      role: 'client',
      hubNodeId: 'bbbbbbbb-peer',
    });
    expect(orchestrator.snapshot().peers[0]?.role).toBe('hub');
    expect(hubPortListener.isListening()).toBe(false);
    expect(records).toContainEqual(
      expect.objectContaining({
        message: 'hub changed',
        fields: expect.objectContaining({
          previousHub: selfNodeId,
          currentHub: 'bbbbbbbb-peer',
        }) as Record<string, unknown>,
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ message: 'hub port released' }),
    );
    await orchestrator.stop();
  });

  it('reports the latest probe against every peer', async () => {
    const { orchestrator, manager } = orchestratorOverFake();
    await orchestrator.start();
    manager().join(fakeNodeInfo('bbbbbbbb-peer'));
    manager().join(fakeNodeInfo('cccccccc-peer'));
    manager().topology = {
      ...manager().topology,
      probes: [
        {
          fromNodeId: selfNodeId,
          toNodeId: 'bbbbbbbb-peer',
          reachable: true,
          latencyMs: 1.5,
          measuredAt: 1_700_000_000_000,
        },
        {
          fromNodeId: selfNodeId,
          toNodeId: 'cccccccc-peer',
          reachable: false,
          latencyMs: -1,
          measuredAt: 1_700_000_000_000,
        },
      ],
    };

    const probes = orchestrator.snapshot().peers.map((peer) => peer.probe);

    expect(probes).toStrictEqual([
      {
        reachable: true,
        latencyMs: 1.5,
        measuredAt: '2023-11-14T22:13:20.000Z',
      },
      {
        reachable: false,
        latencyMs: null,
        measuredAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
    await orchestrator.stop();
  });

  it('forwards the manager log: probe and election at debug, the rest at info', async () => {
    const { orchestrator, manager, records } = orchestratorOverFake();
    await orchestrator.start();

    manager().emit('log', { category: 'probe', message: 'Cycle: 1/1' });
    manager().emit('log', { category: 'election', message: 'Elected: x' });
    manager().emit('log', { category: 'layer', message: 'Broadcast active' });

    expect(records).toContainEqual({
      level: 'debug',
      message: 'Cycle: 1/1',
      fields: { category: 'probe' },
    });
    expect(records).toContainEqual({
      level: 'debug',
      message: 'Elected: x',
      fields: { category: 'election' },
    });
    expect(records).toContainEqual({
      level: 'info',
      message: 'Broadcast active',
      fields: { category: 'layer' },
    });
    await orchestrator.stop();
  });

  it('stops the manager and reports standalone afterwards', async () => {
    const { orchestrator, manager, records } = orchestratorOverFake();
    await orchestrator.start();
    manager().join(fakeNodeInfo('bbbbbbbb-peer'));

    await orchestrator.stop();

    expect(manager().stopped).toBe(true);
    expect(orchestrator.snapshot()).toMatchObject({
      nodeId: selfNodeId,
      role: 'standalone',
      peers: [],
    });
    expect(records).toContainEqual(
      expect.objectContaining({ message: 'discovery stopped' }),
    );
  });
});
