import type { FastifyBaseLogger } from 'fastify';

import type { NodeReport } from './nodeDirectory.ts';
import type { NetworkSnapshot } from './roleOrchestrator.ts';

/**
 * Why a peer is kept out of this node's hub election:
 *
 * - `peer-restarted`: the peer reports a different start time for its id
 *   than the peer table holds. `@rljson/network` never refreshes a known
 *   peer's `startedAt`, so a peer that restarted with its persistent id
 *   within the broadcast timeout keeps the start time of its previous run
 *   in every survivor's election, where it may still count as the
 *   earliest node (`docs/findings/network-discovery.md`, rljson issue 07).
 *   Excluding it is what the correct start time would do: a node that
 *   holds a stale entry was running before the peer restarted, so it is
 *   earlier than the peer's current run and the peer could never win its
 *   election with the true value.
 * - `hub-denies-role`: the node this node follows as hub reports another
 *   role for longer than a grace period. That is the same split seen
 *   from a peer that reports no start time (a node of an older version),
 *   or a hub that stepped down for a reason this node cannot see.
 */
export type RepairCause = 'peer-restarted' | 'hub-denies-role';

/**
 * What the repair reads and does: the orchestrator's view of the network
 * (this node's id, the hub and the peer table), what the reachable nodes
 * report about themselves (the directory's polls), and the exclusion the
 * orchestrator forwards to `NetworkManager`.
 */
export type RepairSources = Readonly<{
  network: () => Pick<NetworkSnapshot, 'nodeId' | 'hubNodeId' | 'peers'>;
  reports: () => readonly NodeReport[];
  excludeFromElection: (nodeId: string, durationMs: number) => void;
}>;

export type TopologyRepairOptions = Readonly<{
  now?: () => number;
  /** How often the two views are compared. */
  checkIntervalMs?: number;
  /**
   * How long a reported start time has to differ from the peer table's
   * before the peer is excluded: two directory rounds, so that a poll from
   * just before a peer left and rejoined (its peer table entry refreshed,
   * the poll not yet) does not count.
   */
  restartGraceMs?: number;
  /** How long the hub may report another role before it is excluded. */
  denialGraceMs?: number;
  /**
   * The least time between two exclusions of the same peer for the same
   * cause, which bounds the repair to one per minute per cause and peer.
   */
  repairIntervalMs?: number;
  /**
   * How long one exclusion lasts: longer than `repairIntervalMs`, so that
   * a condition that persists (a stale entry stays until the peer leaves
   * for longer than the broadcast timeout) keeps the peer excluded
   * without a gap, and short enough that a condition that ended lapses
   * on its own.
   */
  exclusionMs?: number;
}>;

type Condition = {
  nodeId: string;
  cause: RepairCause;
  since: number;
  details: Record<string, string | null>;
};

const conditionKey = (nodeId: string, cause: RepairCause): string =>
  `${cause} ${nodeId}`;

/**
 * Detects a peer table entry that disagrees with what the peer itself
 * reports and repairs this node's hub election with the least invasive
 * means `@rljson/network` offers, a timed exclusion of that peer
 * (slice D7). Two views are compared every `checkIntervalMs`: the peers
 * discovery holds (`startedAt` as first announced) against the `/status`
 * answers the directory polls (`identity.startedAt` of the peer's current
 * run, its role). A peer whose start time moved while its id stayed is
 * excluded once the difference persisted for `restartGraceMs`; the hub
 * this node follows is excluded when it reports another role for
 * `denialGraceMs`. Every exclusion is logged with its cause, lasts
 * `exclusionMs` and is renewed while the condition holds, at most once
 * per `repairIntervalMs` per peer and cause.
 *
 * A restart of the `NetworkManager` would clear the stale entry too, but
 * it gives this node a new start time as well, which every other node
 * then holds stale in turn; the exclusion changes nothing this node
 * announces.
 */
export class TopologyRepair {
  private readonly sources: RepairSources;
  private readonly logger: FastifyBaseLogger;
  private readonly now: () => number;
  private readonly checkIntervalMs: number;
  private readonly restartGraceMs: number;
  private readonly denialGraceMs: number;
  private readonly repairIntervalMs: number;
  private readonly exclusionMs: number;
  private readonly conditions = new Map<string, Condition>();
  private readonly repairedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    sources: RepairSources,
    logger: FastifyBaseLogger,
    options: TopologyRepairOptions = {},
  ) {
    this.sources = sources;
    this.logger = logger;
    this.now = options.now ?? Date.now;
    this.checkIntervalMs = options.checkIntervalMs ?? 1_000;
    this.restartGraceMs = options.restartGraceMs ?? 5_000;
    this.denialGraceMs = options.denialGraceMs ?? 10_000;
    this.repairIntervalMs = options.repairIntervalMs ?? 60_000;
    this.exclusionMs = options.exclusionMs ?? 90_000;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.conditions.clear();
    this.repairedAt.clear();
  }

  /** Compares the two views once and repairs what has persisted long enough. */
  check(): void {
    const now = this.now();
    const network = this.sources.network();
    if (network.nodeId === null) {
      return;
    }
    const reports = new Map(
      this.sources.reports().map((report) => [report.nodeId, report]),
    );

    const observed = new Set<string>();
    for (const peer of network.peers) {
      const reported = reports.get(peer.nodeId)?.startedAt ?? null;
      if (reported !== null && reported !== peer.startedAt) {
        observed.add(
          this.observe(peer.nodeId, 'peer-restarted', now, {
            knownStartedAt: peer.startedAt,
            reportedStartedAt: reported,
          }),
        );
      }
    }
    const hubNodeId = network.hubNodeId;
    if (hubNodeId !== null && hubNodeId !== network.nodeId) {
      const reportedRole = reports.get(hubNodeId)?.role ?? null;
      if (reportedRole !== null && reportedRole !== 'hub') {
        observed.add(
          this.observe(hubNodeId, 'hub-denies-role', now, { reportedRole }),
        );
      }
    }
    for (const key of this.conditions.keys()) {
      if (!observed.has(key)) {
        this.conditions.delete(key);
      }
    }

    for (const [key, condition] of this.conditions) {
      if (now - condition.since < this.graceOf(condition.cause)) {
        continue;
      }
      const repaired = this.repairedAt.get(key);
      if (repaired !== undefined && now - repaired < this.repairIntervalMs) {
        continue;
      }
      this.repairedAt.set(key, now);
      this.logger.warn(
        {
          nodeId: condition.nodeId,
          cause: condition.cause,
          ...condition.details,
          observedForMs: now - condition.since,
          excludedForMs: this.exclusionMs,
        },
        'peer excluded from the hub election',
      );
      this.sources.excludeFromElection(condition.nodeId, this.exclusionMs);
    }
    for (const [key, repaired] of this.repairedAt) {
      if (now - repaired >= this.repairIntervalMs && !observed.has(key)) {
        this.repairedAt.delete(key);
      }
    }
  }

  private observe(
    nodeId: string,
    cause: RepairCause,
    now: number,
    details: Condition['details'],
  ): string {
    const key = conditionKey(nodeId, cause);
    const condition = this.conditions.get(key);
    if (condition === undefined) {
      this.conditions.set(key, { nodeId, cause, since: now, details });
    } else {
      condition.details = details;
    }
    return key;
  }

  private graceOf(cause: RepairCause): number {
    return cause === 'peer-restarted'
      ? this.restartGraceMs
      : this.denialGraceMs;
  }
}
