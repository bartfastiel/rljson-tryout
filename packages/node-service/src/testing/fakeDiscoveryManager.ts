import {
  NodeIdentity,
  type NetworkConfig,
  type NetworkManagerEventName,
  type NetworkManagerEvents,
  type NetworkTopology,
  type NodeInfo,
  type NodeRole,
} from '@rljson/network';

import type { DiscoveryManager } from '../network/roleOrchestrator.ts';

type Listener = (...args: never[]) => void;

export const fakeNodeInfo = (
  nodeId: string,
  overrides: Partial<NodeInfo> = {},
): NodeInfo => ({
  nodeId,
  hostname: `host-${nodeId}`,
  localIps: [`10.0.0.${nodeId.length}`],
  domain: 'petshop-test',
  port: 3000,
  startedAt: 1_000,
  ...overrides,
});

/**
 * A `NetworkManager` stand-in for the orchestrator's unit tests: it never
 * opens a socket, remembers the configuration it was built with, serves
 * whatever topology a test puts into it and lets the test emit the events
 * the real manager would.
 */
export class FakeDiscoveryManager implements DiscoveryManager {
  readonly config: NetworkConfig;
  readonly identity: NodeIdentity;
  topology: NetworkTopology;
  started = false;
  stopped = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(config: NetworkConfig, self: NodeInfo) {
    this.config = config;
    this.identity = new NodeIdentity(self);
    this.topology = {
      domain: config.domain,
      hubNodeId: null,
      hubAddress: null,
      formedBy: 'static',
      formedAt: 0,
      nodes: { [self.nodeId]: self },
      probes: [],
      myRole: 'unassigned',
    };
  }

  async start(): Promise<void> {
    this.started = true;
    this.emit('topology-changed', { topology: this.topology });
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  on<E extends NetworkManagerEventName>(
    event: E,
    callback: NetworkManagerEvents[E],
  ): void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as Listener);
  }

  getTopology(): NetworkTopology {
    return this.topology;
  }

  getIdentity(): NodeIdentity {
    return this.identity;
  }

  emit<E extends NetworkManagerEventName>(
    event: E,
    ...args: Parameters<NetworkManagerEvents[E]>
  ): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as unknown as (...values: typeof args) => void)(...args);
    }
  }

  /** Adds the peer to the topology and announces it like the real manager. */
  join(peer: NodeInfo): void {
    this.topology = {
      ...this.topology,
      nodes: { ...this.topology.nodes, [peer.nodeId]: peer },
    };
    this.emit('peer-joined', peer);
    this.emit('topology-changed', { topology: this.topology });
  }

  leave(nodeId: string): void {
    const nodes = { ...this.topology.nodes };
    delete nodes[nodeId];
    this.topology = { ...this.topology, nodes };
    this.emit('peer-left', nodeId);
    this.emit('topology-changed', { topology: this.topology });
  }

  /** Settles the election on the given hub and announces every change. */
  elect(hubNodeId: string, hubAddress: string): void {
    this.settle(hubNodeId, hubAddress);
  }

  /** Drops the hub, as the real manager does when no candidate is left. */
  unassign(): void {
    this.settle(null, null);
  }

  /**
   * Emits the events in the order `NetworkManager._recomputeTopology`
   * emits them: the hub change first, then the role change, then the
   * topology.
   */
  private settle(hubNodeId: string | null, hubAddress: string | null): void {
    const previousRole = this.topology.myRole;
    const previousHub = this.topology.hubNodeId;
    let myRole: NodeRole = 'unassigned';
    if (hubNodeId !== null) {
      myRole = hubNodeId === this.identity.nodeId ? 'hub' : 'client';
    }
    this.topology = { ...this.topology, hubNodeId, hubAddress, myRole };
    if (previousHub !== hubNodeId) {
      this.emit('hub-changed', { previousHub, currentHub: hubNodeId });
    }
    if (previousRole !== myRole) {
      this.emit('role-changed', { previous: previousRole, current: myRole });
    }
    this.emit('topology-changed', { topology: this.topology });
  }
}
