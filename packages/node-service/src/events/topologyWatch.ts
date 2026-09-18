import {
  buildTopologyReport,
  type TopologyReport,
  type TopologySources,
} from '../routes/status.ts';

export type TopologyListener = (topology: TopologyReport) => void;

export type TopologyWatchOptions = Readonly<{
  /**
   * How often the report is rebuilt without a trigger, which is how the
   * changes of the hub transport (a client that connected, a socket that
   * dropped) and of the directory (a node that became reachable) reach
   * the stream; the orchestrator's events trigger a check at once.
   */
  pollIntervalMs?: number;
}>;

/**
 * The part of a report that counts as a change: everything but the
 * timestamps that advance on their own (`lastSeen` of a peer or a node,
 * the moment and latency of a probe), which would otherwise turn every
 * probe cycle and every directory poll into a `topology` event.
 */
export const topologyFingerprint = (topology: TopologyReport): string =>
  JSON.stringify({
    ...topology,
    peers: topology.peers.map((peer) => ({
      ...peer,
      lastSeen: null,
      probe: peer.probe === null ? null : { reachable: peer.probe.reachable },
    })),
    nodes: topology.nodes.map((node) => ({ ...node, lastSeen: null })),
  });

/**
 * Publishes the `TopologyReport` of this node whenever it changes: on
 * every `check`, which the orchestrator triggers with each discovery
 * event, and on a timer that catches what has no event of its own.
 * `start` remembers the report as it stands, so only what changes after
 * it is published; where the node stands right now a client reads from
 * `/status`.
 */
export class TopologyWatch {
  private readonly sources: TopologySources;
  private readonly listener: TopologyListener;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastFingerprint: string | null = null;

  constructor(
    sources: TopologySources,
    listener: TopologyListener,
    options: TopologyWatchOptions = {},
  ) {
    this.sources = sources;
    this.listener = listener;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  /** Remembers the current report and checks it every interval. */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.lastFingerprint = topologyFingerprint(
      buildTopologyReport(this.sources),
    );
    this.timer = setInterval(() => this.check(), this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Rebuilds the report and publishes it when it differs from the last. */
  check(): void {
    if (this.timer === null) {
      return;
    }
    const topology = buildTopologyReport(this.sources);
    const fingerprint = topologyFingerprint(topology);
    if (fingerprint === this.lastFingerprint) {
      return;
    }
    this.lastFingerprint = fingerprint;
    this.listener(topology);
  }
}
