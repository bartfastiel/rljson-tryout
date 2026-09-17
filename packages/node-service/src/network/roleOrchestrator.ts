import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  NetworkManager,
  type NetworkConfig,
  type NetworkLogEntry,
  type NetworkTopology,
  type NodeInfo,
  type RoleChangedEvent,
} from '@rljson/network';
import type { FastifyBaseLogger } from 'fastify';

import type { Configuration } from '../configuration.ts';
import { HubPortListener } from './hubPortListener.ts';

/**
 * This node's role as `/status` reports it. `starting` until discovery has
 * produced a topology (or, with peers known, until the election has
 * settled), `standalone` while no other node of the domain is known (or
 * discovery is disabled), otherwise the `hub` or `client` role of
 * `@rljson/network`.
 */
export type NodeRole = 'starting' | 'standalone' | 'hub' | 'client';

export type PeerProbeSnapshot = Readonly<{
  reachable: boolean;
  latencyMs: number | null;
  measuredAt: string;
}>;

/**
 * One other node of the domain as discovery knows it: its identity, where
 * to reach its hub port, the role it holds in the current topology, when
 * this node first and last saw it, and the latest TCP probe against it.
 * `lastSeen` means "still known to discovery at that time": it advances
 * with every topology recompute (every probe cycle at the latest) for as
 * long as the peer is in the peer table, and a peer that stopped
 * announcing keeps advancing until the broadcast timeout drops it. It is
 * not a heartbeat; `probe.measuredAt` and `probe.reachable` say whether
 * the peer actually answered.
 */
export type PeerSnapshot = Readonly<{
  nodeId: string;
  hostname: string;
  addresses: readonly string[];
  port: number;
  role: 'hub' | 'client' | null;
  startedAt: string;
  firstSeen: string;
  lastSeen: string;
  probe: PeerProbeSnapshot | null;
}>;

export type NetworkSnapshot = Readonly<{
  nodeId: string | null;
  role: NodeRole;
  domain: string;
  hubNodeId: string | null;
  hubAddress: string | null;
  peers: readonly PeerSnapshot[];
}>;

/**
 * The part of `NetworkManager` the orchestrator uses, so that the unit
 * tests can drive the state machine with a fake that emits events.
 */
export type DiscoveryManager = Pick<
  NetworkManager,
  'start' | 'stop' | 'on' | 'getTopology' | 'getIdentity'
>;

export type RoleOrchestratorOptions = Readonly<{
  createDiscoveryManager?: (config: NetworkConfig) => DiscoveryManager;
  hubPortListener?: HubPortListener;
  now?: () => number;
}>;

type SeenTimes = { firstSeen: number; lastSeen: number };

const isoString = (milliseconds: number): string =>
  new Date(milliseconds).toISOString();

/**
 * Owns the `NetworkManager` of `@rljson/network` (roadmap section 3.3 and
 * decision D4 of `docs/plan.md`): starts discovery with the configured
 * domain and ports, keeps the identity under `<DATA_DIR>/identity`,
 * follows the role the election gives this node, holds the hub port while
 * this node is the hub, logs every transition and answers with a snapshot
 * for `/status`. Slice D2 adds the hub transport and the client connection
 * on top of the same role changes.
 */
export type RoleOrchestratorConfiguration = Pick<
  Configuration,
  'rljsonDomain' | 'hubPort' | 'broadcastPort' | 'dataDirectory' | 'discovery'
>;

export class RoleOrchestrator {
  private readonly configuration: RoleOrchestratorConfiguration;
  private readonly logger: FastifyBaseLogger;
  private readonly createDiscoveryManager: (
    config: NetworkConfig,
  ) => DiscoveryManager;
  private readonly hubPortListener: HubPortListener;
  private readonly now: () => number;
  private readonly seen = new Map<string, SeenTimes>();
  private manager: DiscoveryManager | null = null;
  private selfNodeId: string | null = null;
  private hubPortTransition: Promise<void> = Promise.resolve();

  constructor(
    configuration: RoleOrchestratorConfiguration,
    logger: FastifyBaseLogger,
    options: RoleOrchestratorOptions = {},
  ) {
    this.configuration = configuration;
    this.logger = logger;
    this.createDiscoveryManager =
      options.createDiscoveryManager ??
      ((config) => new NetworkManager(config));
    this.hubPortListener = options.hubPortListener ?? new HubPortListener();
    this.now = options.now ?? Date.now;
  }

  /**
   * With discovery enabled, binds the probe listener on the hub port and
   * the broadcast socket, loads or creates the persistent node id and
   * starts announcing and probing. With discovery disabled the node gets a
   * fresh id for this process and stays `standalone`; no socket is opened.
   * A second call changes nothing: the manager, its sockets and the node
   * id of the first call stay in place.
   */
  async start(): Promise<void> {
    if (this.selfNodeId !== null) {
      return;
    }

    if (this.configuration.discovery === 'disabled') {
      this.selfNodeId = randomUUID();
      this.logger.info(
        { nodeId: this.selfNodeId, domain: this.configuration.rljsonDomain },
        'discovery disabled, running standalone',
      );
      return;
    }

    const identityDirectory = join(
      this.configuration.dataDirectory,
      'identity',
    );
    mkdirSync(identityDirectory, { recursive: true });
    const manager = this.createDiscoveryManager({
      domain: this.configuration.rljsonDomain,
      port: this.configuration.hubPort,
      identityDir: identityDirectory,
      broadcast: { enabled: true, port: this.configuration.broadcastPort },
      probing: { enabled: true },
    });
    this.subscribe(manager);
    await manager.start();
    const identity = manager.getIdentity();
    this.selfNodeId = identity.nodeId;
    this.manager = manager;
    this.logger.info(
      {
        nodeId: identity.nodeId,
        hostname: identity.hostname,
        addresses: identity.localIps,
        domain: identity.domain,
        hubPort: identity.port,
        broadcastPort: this.configuration.broadcastPort,
        identityDirectory,
      },
      'discovery started',
    );
  }

  /**
   * Stops discovery and releases the hub port; the port is released even
   * when the manager fails to stop, so that a restart of this process can
   * bind it again.
   */
  async stop(): Promise<void> {
    const manager = this.manager;
    this.manager = null;
    try {
      if (manager !== null) {
        await manager.stop();
        this.logger.info('discovery stopped');
      }
    } finally {
      await this.hubPortTransition;
      await this.hubPortListener.stop();
    }
  }

  snapshot(): NetworkSnapshot {
    const domain = this.configuration.rljsonDomain;
    if (this.selfNodeId === null) {
      return {
        nodeId: null,
        role: 'starting',
        domain,
        hubNodeId: null,
        hubAddress: null,
        peers: [],
      };
    }
    if (this.manager === null) {
      return {
        nodeId: this.selfNodeId,
        role: 'standalone',
        domain,
        hubNodeId: null,
        hubAddress: null,
        peers: [],
      };
    }

    const topology = this.manager.getTopology();
    const peers = this.peersOf(topology);
    return {
      nodeId: this.selfNodeId,
      role: this.roleOf(topology, peers.length),
      domain,
      hubNodeId: topology.hubNodeId,
      hubAddress: topology.hubAddress,
      peers,
    };
  }

  private roleOf(topology: NetworkTopology, peerCount: number): NodeRole {
    if (topology.myRole === 'hub' || topology.myRole === 'client') {
      return topology.myRole;
    }
    return peerCount === 0 ? 'standalone' : 'starting';
  }

  private peersOf(topology: NetworkTopology): PeerSnapshot[] {
    const now = this.now();
    return Object.values(topology.nodes)
      .filter((node) => node.nodeId !== this.selfNodeId)
      .map((node): PeerSnapshot => {
        const probe = topology.probes.find(
          (candidate) => candidate.toNodeId === node.nodeId,
        );
        const seen = this.seen.get(node.nodeId) ?? {
          firstSeen: now,
          lastSeen: now,
        };
        let role: PeerSnapshot['role'] = null;
        if (topology.hubNodeId !== null) {
          role = topology.hubNodeId === node.nodeId ? 'hub' : 'client';
        }

        return {
          nodeId: node.nodeId,
          hostname: node.hostname,
          addresses: [...node.localIps],
          port: node.port,
          role,
          startedAt: isoString(node.startedAt),
          firstSeen: isoString(seen.firstSeen),
          lastSeen: isoString(seen.lastSeen),
          probe:
            probe === undefined
              ? null
              : {
                  reachable: probe.reachable,
                  latencyMs: probe.reachable ? probe.latencyMs : null,
                  measuredAt: isoString(probe.measuredAt),
                },
        };
      })
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  private subscribe(manager: DiscoveryManager): void {
    manager.on('peer-joined', (peer: NodeInfo) => {
      const now = this.now();
      this.seen.set(peer.nodeId, { firstSeen: now, lastSeen: now });
      this.logger.info(
        {
          nodeId: peer.nodeId,
          hostname: peer.hostname,
          addresses: peer.localIps,
          port: peer.port,
        },
        'peer joined',
      );
    });
    manager.on('peer-left', (nodeId: string) => {
      this.seen.delete(nodeId);
      this.logger.info({ nodeId }, 'peer left');
    });
    manager.on('topology-changed', ({ topology }) => {
      const selfNodeId = manager.getIdentity().nodeId;
      const now = this.now();
      for (const node of Object.values(topology.nodes)) {
        if (node.nodeId === selfNodeId) {
          continue;
        }
        const seen = this.seen.get(node.nodeId);
        if (seen === undefined) {
          this.seen.set(node.nodeId, { firstSeen: now, lastSeen: now });
        } else {
          seen.lastSeen = now;
        }
      }
    });
    manager.on('role-changed', (event: RoleChangedEvent) => {
      this.logger.info(
        { previous: event.previous, current: event.current },
        'role changed',
      );
      this.ownHubPort(event.current === 'hub');
    });
    manager.on('hub-changed', (event) => {
      this.logger.info(
        {
          previousHub: event.previousHub,
          currentHub: event.currentHub,
          hubAddress: manager.getTopology().hubAddress,
        },
        'hub changed',
      );
    });
    manager.on('log', (entry: NetworkLogEntry) => {
      // Election and probe messages repeat on every probe cycle; the
      // transitions that matter are logged above at info level.
      if (entry.category === 'election' || entry.category === 'probe') {
        this.logger.debug({ category: entry.category }, entry.message);
      } else {
        this.logger.info({ category: entry.category }, entry.message);
      }
    });
  }

  /**
   * Transitions are queued so that a role flapping faster than a bind or a
   * close completes still leaves the port in the state of the last change.
   */
  private ownHubPort(shouldOwn: boolean): void {
    const port = this.configuration.hubPort;
    this.hubPortTransition = this.hubPortTransition
      .then(async () => {
        if (shouldOwn && !this.hubPortListener.isListening()) {
          await this.hubPortListener.start(port);
          this.logger.info({ port }, 'hub port bound');
        } else if (!shouldOwn && this.hubPortListener.isListening()) {
          await this.hubPortListener.stop();
          this.logger.info({ port }, 'hub port released');
        }
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, port }, 'hub port transition failed');
      });
  }
}
