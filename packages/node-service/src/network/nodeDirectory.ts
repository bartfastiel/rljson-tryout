import type { FastifyBaseLogger } from 'fastify';

import type { Configuration } from '../configuration.ts';
import type { NodeRole } from './roleOrchestrator.ts';

/**
 * What a node reports about its own id under `/status.identity`, as far
 * as the directory keeps it: whether the id was restored from its data
 * directory and when its current run of discovery started (slice D7).
 */
export type ReportedIdentity = Readonly<{
  persistent: boolean;
  startedAt: string;
}>;

/**
 * One node of the environment as `NODE_URLS` lists it, with what the last
 * `GET /status` against it revealed: its display name, its node id, the
 * role it reported, when it is the hub, how many clients its hub
 * transport holds (`null` otherwise), and its identity (`null` until it
 * answered, or for a node that does not report one). `self` marks the
 * entry whose URL is this node's own `PUBLIC_URL`; it is never fetched
 * over HTTP, its values come from the local snapshot instead.
 */
export type DirectoryEntry = Readonly<{
  url: string;
  self: boolean;
  name: string | null;
  nodeId: string | null;
  role: NodeRole | null;
  connectedClients: number | null;
  identity: ReportedIdentity | null;
  reachable: boolean;
  lastSeen: string | null;
}>;

/**
 * What this node knows about itself, so that its own directory entry
 * carries the same fields as the polled ones.
 */
export type SelfDescription = Readonly<{
  name: string;
  nodeId: string | null;
  role: NodeRole;
  connectedClients: number | null;
  identity: ReportedIdentity | null;
}>;

/**
 * What a reachable node of the environment last said about itself, for
 * whoever compares it with what discovery holds (`TopologyRepair`): its
 * id, its role, and the start time of its current run of discovery
 * (`null` for a node that reports no identity).
 */
export type NodeReport = Readonly<{
  nodeId: string;
  role: NodeRole | null;
  startedAt: string | null;
}>;

export type NodeDirectoryOptions = Readonly<{
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
}>;

type PolledStatus = {
  statusUrl: string;
  name: string | null;
  nodeId: string | null;
  role: NodeRole | null;
  connectedClients: number | null;
  identity: ReportedIdentity | null;
  reachable: boolean;
  lastSeen: number | null;
};

const nodeRoles: ReadonlySet<NodeRole> = new Set<NodeRole>([
  'starting',
  'standalone',
  'hub',
  'client',
]);

const unknownStatus = (statusUrl: string): PolledStatus => ({
  statusUrl,
  name: null,
  nodeId: null,
  role: null,
  connectedClients: null,
  identity: null,
  reachable: false,
  lastSeen: null,
});

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const readRole = (value: unknown): NodeRole | null =>
  nodeRoles.has(value as NodeRole) ? (value as NodeRole) : null;

/**
 * The `identity` of a polled `/status`, when the node reports one with a
 * start time; a node of a version before slice D7 reports none.
 */
const readIdentity = (identity: unknown): ReportedIdentity | null => {
  if (typeof identity !== 'object' || identity === null) {
    return null;
  }
  const { persistent, startedAt } = identity as {
    persistent?: unknown;
    startedAt?: unknown;
  };
  const started = readString(startedAt);
  return started === null
    ? null
    : { persistent: persistent === true, startedAt: started };
};

/**
 * The `transport.connectedClients` of a polled `/status`, which only a
 * hub reports.
 */
const readConnectedClients = (transport: unknown): number | null => {
  if (typeof transport !== 'object' || transport === null) {
    return null;
  }
  const count = (transport as { connectedClients?: unknown }).connectedClients;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? count
    : null;
};

/**
 * Polls `GET /status` of every other node named in `NODE_URLS` every few
 * seconds with a short timeout and remembers name, node id and role per
 * URL. This is how a URL a browser can open is correlated with the node id
 * discovery sees: `@rljson/network` announces ids and IP addresses, never
 * public URLs or display names. Nothing in the announcement carries a name,
 * so the correlation has to come from the nodes themselves. The poll goes
 * to the `NODE_STATUS_URLS` entry at the same position (the in-cluster
 * address in Kubernetes), the entries keep the public URL as their key.
 */
export class NodeDirectory {
  private readonly publicUrl: string;
  private readonly logger: FastifyBaseLogger;
  private readonly fetch: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly urls: readonly string[];
  private readonly polled = new Map<string, PolledStatus>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    configuration: Pick<
      Configuration,
      'publicUrl' | 'nodeUrls' | 'nodeStatusUrls'
    >,
    logger: FastifyBaseLogger,
    options: NodeDirectoryOptions = {},
  ) {
    this.publicUrl = configuration.publicUrl;
    this.logger = logger;
    this.fetch = options.fetch ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.now = options.now ?? Date.now;
    this.urls = configuration.nodeUrls.includes(configuration.publicUrl)
      ? configuration.nodeUrls
      : [configuration.publicUrl, ...configuration.nodeUrls];
    configuration.nodeUrls.forEach((url, index) => {
      if (url !== configuration.publicUrl) {
        this.polled.set(
          url,
          unknownStatus(configuration.nodeStatusUrls[index]),
        );
      }
    });
  }

  /**
   * Polls once right away and then again `pollIntervalMs` after each round
   * finished, so slow nodes never make rounds overlap. Resolves after the
   * first round so that a caller can rely on the directory being filled.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.pollAll();
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Every node of the environment in the order of `NODE_URLS`, this node
   * included (first when `NODE_URLS` does not list it). `seenInTopology`
   * is true for this node itself and for every node whose id discovery
   * currently lists as a peer.
   */
  entries(
    self: SelfDescription,
    peerNodeIds: readonly string[],
  ): (DirectoryEntry & { seenInTopology: boolean })[] {
    return this.urls.map((url) => {
      if (url === this.publicUrl) {
        return {
          url,
          self: true,
          name: self.name,
          nodeId: self.nodeId,
          role: self.role,
          connectedClients: self.connectedClients,
          identity: self.identity,
          reachable: true,
          lastSeen: new Date(this.now()).toISOString(),
          seenInTopology: true,
        };
      }
      const status = this.polled.get(url) ?? unknownStatus(url);
      return {
        url,
        self: false,
        name: status.name,
        nodeId: status.nodeId,
        role: status.role,
        connectedClients: status.connectedClients,
        identity: status.identity,
        reachable: status.reachable,
        lastSeen:
          status.lastSeen === null
            ? null
            : new Date(status.lastSeen).toISOString(),
        seenInTopology:
          status.nodeId !== null && peerNodeIds.includes(status.nodeId),
      };
    });
  }

  /**
   * The display name a node reported for the given id, when any polled
   * node carries it.
   */
  nameOf(nodeId: string): string | null {
    for (const status of this.polled.values()) {
      if (status.nodeId === nodeId) {
        return status.name;
      }
    }
    return null;
  }

  /**
   * What every node that answered the last poll round reports about
   * itself. A node that did not answer is left out: its last answer may
   * be from before a restart.
   */
  reports(): NodeReport[] {
    const reports: NodeReport[] = [];
    for (const status of this.polled.values()) {
      if (status.reachable && status.nodeId !== null) {
        reports.push({
          nodeId: status.nodeId,
          role: status.role,
          startedAt: status.identity?.startedAt ?? null,
        });
      }
    }
    return reports;
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pollAll().then(() => this.scheduleNext());
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  private async pollAll(): Promise<void> {
    await Promise.all(
      [...this.polled].map(([url, status]) => this.poll(url, status)),
    );
  }

  private async poll(url: string, status: PolledStatus): Promise<void> {
    const statusUrl = status.statusUrl;
    try {
      const response = await this.fetch(`${statusUrl}/status`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`answered ${response.status}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      const nodeId = readString(body.nodeId);
      if (!status.reachable) {
        this.logger.info({ url, statusUrl, nodeId }, 'node reachable');
      }
      status.name = readString(body.nodeName);
      status.nodeId = nodeId;
      status.role = readRole(body.role);
      status.connectedClients = readConnectedClients(body.transport);
      status.identity = readIdentity(body.identity);
      status.reachable = true;
      status.lastSeen = this.now();
    } catch (error) {
      if (status.reachable) {
        this.logger.warn({ url, statusUrl, err: error }, 'node unreachable');
      }
      status.reachable = false;
      status.connectedClients = null;
    }
  }
}
