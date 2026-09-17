import type { FastifyBaseLogger } from 'fastify';

import type { Configuration } from '../configuration.ts';
import type { NodeRole } from './roleOrchestrator.ts';

/**
 * One node of the environment as `NODE_URLS` lists it, with what the last
 * `GET /status` against it revealed: its display name, its node id and the
 * role it reported. `self` marks the entry whose URL is this node's own
 * `PUBLIC_URL`; it is never fetched over HTTP, its values come from the
 * local snapshot instead.
 */
export type DirectoryEntry = Readonly<{
  url: string;
  self: boolean;
  name: string | null;
  nodeId: string | null;
  role: NodeRole | null;
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
}>;

export type NodeDirectoryOptions = Readonly<{
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
}>;

type PolledStatus = {
  name: string | null;
  nodeId: string | null;
  role: NodeRole | null;
  reachable: boolean;
  lastSeen: number | null;
};

const nodeRoles: ReadonlySet<NodeRole> = new Set<NodeRole>([
  'starting',
  'standalone',
  'hub',
  'client',
]);

const unknownStatus = (): PolledStatus => ({
  name: null,
  nodeId: null,
  role: null,
  reachable: false,
  lastSeen: null,
});

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const readRole = (value: unknown): NodeRole | null =>
  nodeRoles.has(value as NodeRole) ? (value as NodeRole) : null;

/**
 * Polls `GET /status` of every other node named in `NODE_URLS` every few
 * seconds with a short timeout and remembers name, node id and role per
 * URL. This is how a URL a browser can open is correlated with the node id
 * discovery sees: `@rljson/network` announces ids and IP addresses, never
 * public URLs or display names. Nothing in the announcement carries a name,
 * so the correlation has to come from the nodes themselves.
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
    configuration: Pick<Configuration, 'publicUrl' | 'nodeUrls'>,
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
    for (const url of this.urls) {
      if (url !== configuration.publicUrl) {
        this.polled.set(url, unknownStatus());
      }
    }
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
          reachable: true,
          lastSeen: new Date(this.now()).toISOString(),
          seenInTopology: true,
        };
      }
      const status = this.polled.get(url) ?? unknownStatus();
      return {
        url,
        self: false,
        name: status.name,
        nodeId: status.nodeId,
        role: status.role,
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
    try {
      const response = await this.fetch(`${url}/status`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`answered ${response.status}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      const nodeId = readString(body.nodeId);
      if (!status.reachable) {
        this.logger.info({ url, nodeId }, 'node reachable');
      }
      status.name = readString(body.nodeName);
      status.nodeId = nodeId;
      status.role = readRole(body.role);
      status.reachable = true;
      status.lastSeen = this.now();
    } catch (error) {
      if (status.reachable) {
        this.logger.warn({ url, err: error }, 'node unreachable');
      }
      status.reachable = false;
    }
  }
}
