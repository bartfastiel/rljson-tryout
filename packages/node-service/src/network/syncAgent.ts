import type { TableCfg } from '@rljson/rljson';
import {
  changeSetsTableCfg,
  hashMatches,
  type ChangeSetItem,
  type HashedChangeSetRow,
} from '@rljson-tryout/domain';
import type { FastifyBaseLogger } from 'fastify';

import {
  byTimeId,
  domainTableCfgs,
  type HeldChangeSet,
  type PetShopStore,
  type ReceivedRow,
  type SyncRow,
} from '../store/petShopStore.ts';
import {
  type Announcement,
  type AnnouncementChannel,
  type AttachedPeer,
} from './announcementChannel.ts';
import {
  referencesOf,
  type HistoryReference,
  type RowReference,
  type RowReferences,
} from './rowReferences.ts';

/**
 * What the agent needs from the node's store: the event for change sets
 * the store wrote itself, the lists and lookups of what it holds, the
 * reads from the peer stores, the local checks and the writes of
 * received rows and change sets.
 */
export type SyncStore = Pick<
  PetShopStore,
  | 'onChangeSetWritten'
  | 'holdsChangeSet'
  | 'heldChangeSets'
  | 'localChangeSet'
  | 'hasLocalRow'
  | 'hasLocalHistoryRow'
  | 'pullRow'
  | 'pullHistoryRow'
  | 'writeReceivedRows'
  | 'recordReceivedChangeSet'
>;

/**
 * Where the agent gets its announcement channel from: the hub transport
 * publishes the channel of the current role, `null` while the node has
 * none, and calls the listener at once with the current one.
 */
export type ChannelSource = {
  subscribe(
    listener: (channel: AnnouncementChannel | null) => void,
  ): () => void;
};

export type SyncDirection = 'incoming' | 'outgoing';
export type SyncStatus = 'completed' | 'pending' | 'failed';

/**
 * One change set transfer as `/status` lists it under `sync.transfers`
 * and the SSE `sync` event streams it: which way it went, which node it
 * came from or went to (`peerNodeId`: on an incoming transfer the node
 * that wrote the change set, when its announcement said so, or the peer
 * whose store the catch-up found it in; on an outgoing one the hub this
 * client announced to, `null` on the hub, which announces to every
 * connected client, or the client the catch-up announced it for), the
 * change set by hash and id, how many rows per table it named, how long
 * the pull took, when it finished, and whether it completed, is still
 * pending (the pull could not finish and is retried) or failed for good,
 * with the reason. The stream additionally hears a transfer the moment
 * its pull starts: `pending` with no `error`, `durationMs` 0 and the id
 * and tables not known yet; `/status` lists outcomes only.
 */
export type SyncTransfer = Readonly<{
  direction: SyncDirection;
  peerNodeId: string | null;
  changeSetHash: string;
  changeSetId: string | null;
  tables: Readonly<Record<string, number>>;
  durationMs: number;
  at: string;
  status: SyncStatus;
  error?: string;
}>;

/**
 * What `/status` reports under `sync.catchUp`: the last catch-up this
 * node ran, when it started, when every change set it found missing had
 * been pulled, skipped or given up (`null` while that is still going on),
 * how many change sets were missing when it started (catch-ups with
 * further peers that start meanwhile add theirs), how many of them were
 * pulled, and how long it took. All empty before the first peer attached.
 */
export type CatchUpSnapshot = Readonly<{
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  missingAtStart: number;
  pulled: number;
  durationMs: number | null;
}>;

/**
 * What `/status` reports under `sync` (roadmap section 2.5): how many
 * change sets this node announced, received completely, skipped because
 * it held them already (an announcement of a change set the catch-up
 * pulled a moment before, the hub's bootstrap of its latest reference),
 * how many are pending and how many failed, the last error, the last ten
 * transfers, newest first, and the last catch-up.
 */
export type SyncSnapshot = Readonly<{
  announced: number;
  received: number;
  skipped: number;
  pending: number;
  failed: number;
  lastError: string | null;
  transfers: readonly SyncTransfer[];
  catchUp: CatchUpSnapshot;
}>;

/** Called with every transfer the moment the agent records or starts it. */
export type TransferListener = (transfer: SyncTransfer) => void;

export type SyncAgentOptions = Readonly<{
  /** How long one change set may take to pull, all its rows together. */
  pullTimeoutMs?: number;
  /** How often pending change sets and failed catch-ups are tried again. */
  retryIntervalMs?: number;
  /** After how many failed pulls a pending change set counts as failed. */
  maxAttempts?: number;
  /** How many rows a change set may pull in beyond its own items. */
  dependencyBound?: number;
  /** How many change sets are pulled at the same time. */
  concurrency?: number;
  /** How many items a change set may name before it is rejected. */
  maxChangeSetItems?: number;
  now?: () => number;
}>;

type PendingChangeSet = {
  fromNodeId: string | null;
  attempts: number;
  firstFailedAt: number | null;
  lastError: string | null;
};

const isHistoryTable = (table: string): boolean =>
  table.endsWith('InsertHistory');

/**
 * The items of a change set in the order they are pulled: the data rows
 * first, the history rows last, so that wherever rows land one by one (the
 * hub's cache of what it fetched for a client) a version becomes current
 * only after the rows it consists of are there.
 */
const dataRowsFirst = (
  items: readonly ChangeSetItem[],
): readonly ChangeSetItem[] => [
  ...items.filter((item) => !isHistoryTable(item.table)),
  ...items.filter((item) => isHistoryTable(item.table)),
];

/** What a pull knows about itself, for the transfer it ends in. */
type PullOutcome = {
  changeSetHash: string;
  fromNodeId: string | null;
  changeSetId: string | null;
  tables: Record<string, number>;
  started: number;
};

/**
 * The catch-up in progress or the last one: when it started, the change
 * sets it found missing and has not settled yet, how many it found and
 * how many of those it pulled, and when the last of them settled.
 */
type CatchUp = {
  startedAt: number;
  completedAt: number | null;
  missingAtStart: number;
  pulled: number;
  outstanding: Set<string>;
};

/**
 * The references still to check while the dependencies of a change set
 * are pulled: rows first, then history rows, each key once.
 */
class DependencyWalk {
  readonly seen = new Set<string>();
  private readonly rows: RowReference[] = [];
  private readonly history: HistoryReference[] = [];

  add(references: RowReferences): void {
    this.rows.push(...references.rows);
    this.history.push(...references.history);
  }

  next(): RowReference | HistoryReference | undefined {
    for (;;) {
      const reference = this.rows.shift() ?? this.history.shift();
      if (reference === undefined) {
        return undefined;
      }
      const key =
        'hash' in reference
          ? `${reference.table}@${reference.hash}`
          : `${reference.table}InsertHistory@${reference.timeId}`;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        return reference;
      }
    }
  }
}

/**
 * A pull that could not finish because a peer could not answer or has
 * not got the rows: the change set stays pending and is tried again.
 */
class PullIncomplete extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PullIncomplete';
  }
}

/**
 * A change set that is dropped for good, since nothing the announcing
 * node serves can be trusted for it (slices D15 and D16 harden this
 * further): a row whose `_hash` does not match its content, a change set
 * row without a list of items, with more items than allowed, or naming a
 * table this store does not have.
 */
class ChangeSetRejected extends Error {
  constructor(table: string, hash: string, reason: string) {
    super(`row ${table}@${hash} ${reason}, skipped`);
    this.name = 'ChangeSetRejected';
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The two ways `@rljson/hash` 0.0.19 words a hash that does not match its
 * content. `IoMulti.readRows` runs `hip` over what a peer returned before
 * it caches it locally (`@rljson/io` 0.0.78); `hip` keeps existing hashes
 * and validates them afterwards, so a tampered row fails the read itself
 * with `Hash "…" is wrong. Should be "…".` before it reaches the agent's
 * own check. `Io.write` of both stores runs `hsh`, which recomputes the
 * hashes and fails with `Hash "…" does not match the newly calculated one
 * "…"` (`docs/findings/change-set-sync.md`). Neither read is worth
 * repeating. `syncAgent.cascade.test.ts` holds both texts against the
 * real cascade and store, so that an upgrade of either package that
 * changes them fails there instead of turning a tampered row into twenty
 * retries.
 */
const hashRejectionMessages = [
  'is wrong. Should be',
  'does not match the newly calculated one',
];

export const isRejectedByCascade = (error: unknown): boolean => {
  const message = errorMessage(error);
  return hashRejectionMessages.some((text) => message.includes(text));
};

const isChangeSetItem = (value: unknown): value is ChangeSetItem =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ChangeSetItem).table === 'string' &&
  typeof (value as ChangeSetItem).ref === 'string';

const countByTable = (
  items: readonly ChangeSetItem[],
): Record<string, number> => {
  const tables: Record<string, number> = {};
  for (const item of items) {
    tables[item.table] = (tables[item.table] ?? 0) + 1;
  }
  return tables;
};

const tableCfgsByKey = (): ReadonlyMap<string, TableCfg> => {
  const byKey = new Map<string, TableCfg>();
  for (const tableCfg of domainTableCfgs) {
    byKey.set(tableCfg.key, tableCfg);
    byKey.set(`${tableCfg.key}InsertHistory`, tableCfg);
  }
  return byKey;
};

const isoTime = (milliseconds: number): string =>
  new Date(milliseconds).toISOString();

/**
 * The change set synchronisation of roadmap slices D3 and D4 and section
 * 3.4.
 *
 * Outgoing: every change set the store writes on its own account (an
 * invoice issued, an animal edited) is announced by hash on the channel
 * of the current role. A change set written while the node has no
 * channel, or announced to nobody (a node that seeded before it joined,
 * a short-lived hub at a cold start), is not kept in a queue: the
 * catch-up below finds every change set a peer lacks and announces it
 * then.
 *
 * Catch-up: whenever a peer attaches (the hub, once a client is connected
 * to it and after every reconnection; every client, once the hub added
 * it), the agent lists the change sets that peer holds through the peer's
 * store alone, never the read cascade, compares them by hash with what
 * this node holds, queues every change set it lacks for a pull in the
 * order the peer learned about them, and announces every change set the
 * peer lacks. Both sides of a connection do this, so a node that restarts
 * learns what the others wrote while it was away, a hub that restarts
 * learns what its clients hold, and a node that joins with a populated
 * store fills the others; a peer that holds the same change sets costs
 * one table read and nothing else. A list that could not be read is
 * tried again every `retryIntervalMs`.
 *
 * Incoming: for every hash that arrives the agent pulls the change set
 * row from the peer stores, then every row the change set names, data
 * rows before history rows, verifies each row's hash against its content,
 * and writes them all in one write exactly as received, so that a reader
 * of this store sees the change set either not at all or complete, never
 * a version without the rows it consists of (a pull that breaks off
 * leaves nothing behind); then it records the change set locally, which
 * is what makes it count as held. The order of the pulls matters for the
 * hub in between too: the hub's `IoServer` caches what it fetched from a
 * third node for a client row by row, in the client's order, so its own
 * readers see a version only after that version's rows. A change set
 * the store already holds is skipped by hash. Rows the
 * received rows point at but this node lacks (a reference to a version
 * from a change set that has not arrived yet, a `previous` of a version
 * from an earlier edit) are pulled too, recursively, up to a bound. A
 * pull whose peer could not answer within `pullTimeoutMs`, or whose rows
 * no node has yet, leaves the change set pending: it is tried again on
 * the next announcement of the same hash and every `retryIntervalMs`,
 * `maxAttempts` times, then counts as failed. A change set is rejected at
 * once when a row does not hash to its content, when it names more than
 * `maxChangeSetItems` items or a table this store does not have. Several
 * change sets are pulled at a time, `concurrency` of them; the order of
 * arrival is kept for the rest.
 */
export class SyncAgent {
  private readonly store: SyncStore;
  private readonly channels: ChannelSource;
  private readonly logger: FastifyBaseLogger;
  private readonly pullTimeoutMs: number;
  private readonly retryIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly dependencyBound: number;
  private readonly concurrency: number;
  private readonly maxChangeSetItems: number;
  private readonly now: () => number;
  private readonly tableCfgs = tableCfgsByKey();

  private channel: AnnouncementChannel | null = null;
  private readonly announcedHashes = new Set<string>();
  private readonly pending = new Map<string, PendingChangeSet>();
  private readonly queue: string[] = [];
  private readonly active = new Map<string, Promise<void>>();
  private readonly transfers: SyncTransfer[] = [];
  private readonly transferListeners = new Set<TransferListener>();
  private readonly counters = {
    announced: 0,
    received: 0,
    skipped: 0,
    failed: 0,
  };
  private lastError: string | null = null;
  private catchUp: CatchUp | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly catchUpRetries = new Set<NodeJS.Timeout>();
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeChannels: (() => void) | null = null;
  private running = false;

  constructor(
    store: SyncStore,
    channels: ChannelSource,
    logger: FastifyBaseLogger,
    options: SyncAgentOptions = {},
  ) {
    this.store = store;
    this.channels = channels;
    this.logger = logger;
    this.pullTimeoutMs = options.pullTimeoutMs ?? 15_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 20;
    this.dependencyBound = options.dependencyBound ?? 200;
    this.concurrency = options.concurrency ?? 4;
    this.maxChangeSetItems = options.maxChangeSetItems ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Starts listening to the store's change sets and to the transport's
   * channel, and starts the retry timer. A second call changes nothing.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.unsubscribeStore = this.store.onChangeSetWritten((changeSet) =>
      this.announce(changeSet),
    );
    this.unsubscribeChannels = this.channels.subscribe((channel) =>
      this.attach(channel),
    );
    this.retryTimer = setInterval(
      () => this.retryPending(),
      this.retryIntervalMs,
    );
    this.retryTimer.unref();
  }

  /**
   * Stops listening and waits for the pulls in flight to settle; pending
   * change sets are forgotten, since the next start of this process
   * catches up on what it missed. A catch-up still waiting for a peer's
   * list is not waited for: it touches nothing once the agent stopped,
   * and a peer that never answers must not hold a shutdown.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeChannels?.();
    this.unsubscribeChannels = null;
    if (this.retryTimer !== null) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.clearCatchUpRetries();
    this.channel = null;
    this.queue.length = 0;
    await Promise.allSettled(this.active.values());
  }

  snapshot(): SyncSnapshot {
    return {
      ...this.counters,
      pending: this.pending.size,
      lastError: this.lastError,
      transfers: [...this.transfers],
      catchUp: this.catchUpSnapshot(),
    };
  }

  private catchUpSnapshot(): CatchUpSnapshot {
    const catchUp = this.catchUp;
    if (catchUp === null) {
      return {
        lastStartedAt: null,
        lastCompletedAt: null,
        missingAtStart: 0,
        pulled: 0,
        durationMs: null,
      };
    }
    return {
      lastStartedAt: isoTime(catchUp.startedAt),
      lastCompletedAt:
        catchUp.completedAt === null ? null : isoTime(catchUp.completedAt),
      missingAtStart: catchUp.missingAtStart,
      pulled: catchUp.pulled,
      durationMs:
        catchUp.completedAt === null
          ? null
          : catchUp.completedAt - catchUp.startedAt,
    };
  }

  /**
   * Registers a listener for every transfer: each one `snapshot` lists,
   * as it is recorded, plus the start of every pull (slice B13 streams
   * them as `sync` events). Returns the function that unregisters it.
   */
  onTransfer(listener: TransferListener): () => void {
    this.transferListeners.add(listener);
    return () => {
      this.transferListeners.delete(listener);
    };
  }

  /**
   * Announces a change set the store wrote on the current channel. Without
   * one, nothing is done: the catch-up on the next attach finds the peer
   * lacks it.
   */
  private announce(changeSet: HashedChangeSetRow): void {
    if (this.channel !== null) {
      this.send(this.channel, changeSet, this.channel.peerNodeId);
    }
  }

  /**
   * Sends a change set's hash. The counter and the transfer list record
   * a change set the first time it goes out; a repeat for a peer the
   * catch-up found lacking it is not a new transfer.
   */
  private send(
    channel: AnnouncementChannel,
    changeSet: HashedChangeSetRow,
    toNodeId: string | null,
  ): void {
    channel.send(changeSet._hash);
    if (this.announcedHashes.has(changeSet._hash)) {
      return;
    }
    this.announcedHashes.add(changeSet._hash);
    this.counters.announced += 1;
    this.record({
      direction: 'outgoing',
      peerNodeId: toNodeId,
      changeSetHash: changeSet._hash,
      changeSetId: changeSet.id,
      tables: countByTable(changeSet.items),
      durationMs: 0,
      at: isoTime(this.now()),
      status: 'completed',
    });
    this.logger.debug(
      {
        changeSetHash: changeSet._hash,
        changeSetId: changeSet.id,
        peerNodeId: toNodeId,
      },
      'change set announced',
    );
  }

  /**
   * Takes the channel of the current role: listens on it and catches up
   * with every peer that attaches through it.
   */
  private attach(channel: AnnouncementChannel | null): void {
    this.clearCatchUpRetries();
    this.channel = channel;
    if (channel === null) {
      return;
    }
    channel.listen((announcement) => this.receive(announcement));
    channel.onPeerAttached((peer) => void this.catchUpWith(channel, peer, 1));
  }

  /**
   * Compares what the peer holds with what this node holds, both read
   * from the respective store alone, queues the change sets this node
   * lacks and announces the ones the peer lacks. The peer's list is given
   * `pullTimeoutMs` like a pull; a peer whose list cannot be read is tried
   * again after `retryIntervalMs`, `maxAttempts` times, and a comparison
   * that fails on this node's side (a store closing under a shutdown) is
   * logged and left to the next attach. Never throws, since nothing
   * awaits it.
   */
  private async catchUpWith(
    channel: AnnouncementChannel,
    peer: AttachedPeer,
    attempt: number,
  ): Promise<void> {
    if (!this.running || this.channel !== channel) {
      return;
    }
    const startedAt = this.now();
    let peerHeld: readonly HeldChangeSet[];
    try {
      peerHeld = await this.within(
        startedAt + this.pullTimeoutMs,
        `the change set list of ${peer.nodeId ?? 'a peer'}`,
        () => peer.heldChangeSets(),
      );
    } catch (error) {
      this.lastError = `catch-up with ${peer.nodeId ?? 'a peer'} failed: ${errorMessage(error)}`;
      this.logger.warn(
        { err: error, peerNodeId: peer.nodeId, attempt },
        'catch-up could not read what the peer holds',
      );
      if (attempt < this.maxAttempts && this.channel === channel) {
        const timer = setTimeout(() => {
          this.catchUpRetries.delete(timer);
          void this.catchUpWith(channel, peer, attempt + 1);
        }, this.retryIntervalMs);
        timer.unref();
        this.catchUpRetries.add(timer);
      }
      return;
    }
    try {
      await this.compareWith(channel, peer, peerHeld, startedAt, attempt);
    } catch (error) {
      this.lastError = `catch-up with ${peer.nodeId ?? 'a peer'} failed: ${errorMessage(error)}`;
      this.logger.warn(
        { err: error, peerNodeId: peer.nodeId, attempt },
        'catch-up could not compare the change sets',
      );
    }
  }

  private async compareWith(
    channel: AnnouncementChannel,
    peer: AttachedPeer,
    peerHeld: readonly HeldChangeSet[],
    startedAt: number,
    attempt: number,
  ): Promise<void> {
    if (!this.running || this.channel !== channel) {
      return;
    }
    const held = await this.store.heldChangeSets();
    const heldHashes = new Set(held.map((entry) => entry.hash));
    const peerHashes = new Set(peerHeld.map((entry) => entry.hash));
    const missing = peerHeld
      .filter((entry) => !heldHashes.has(entry.hash))
      .sort(byTimeId);
    const lacking = held
      .filter((entry) => !peerHashes.has(entry.hash))
      .sort(byTimeId);

    this.beginCatchUp(
      startedAt,
      missing.map((entry) => entry.hash),
    );
    for (const entry of missing) {
      this.receive({ changeSetHash: entry.hash, fromNodeId: peer.nodeId });
    }
    let announced = 0;
    for (const entry of lacking) {
      if (!this.running || this.channel !== channel) {
        break;
      }
      const changeSet = await this.store.localChangeSet(entry.hash);
      if (changeSet !== undefined) {
        this.send(channel, changeSet, peer.nodeId ?? channel.peerNodeId);
        announced += 1;
      }
    }
    this.logger.info(
      {
        peerNodeId: peer.nodeId,
        peerHolds: peerHeld.length,
        holds: held.length,
        missing: missing.length,
        announced,
        attempt,
      },
      'catch-up started',
    );
    this.settleCatchUp();
  }

  /**
   * Opens a catch-up for the given missing change sets, or adds them to
   * the one still running when several peers attach in a row.
   */
  private beginCatchUp(startedAt: number, missing: readonly string[]): void {
    const running = this.runningCatchUp();
    if (running === null) {
      this.catchUp = {
        startedAt,
        completedAt: null,
        missingAtStart: missing.length,
        pulled: 0,
        outstanding: new Set(missing),
      };
      return;
    }
    for (const changeSetHash of missing) {
      if (!running.outstanding.has(changeSetHash)) {
        running.outstanding.add(changeSetHash);
        running.missingAtStart += 1;
      }
    }
  }

  /** The catch-up still waiting for change sets, `null` when none is. */
  private runningCatchUp(): CatchUp | null {
    return this.catchUp?.completedAt === null ? this.catchUp : null;
  }

  /**
   * Notes that a change set the catch-up was waiting for settled: pulled,
   * skipped or given up. The catch-up completes with the last one.
   */
  private settled(changeSetHash: string, pulled: boolean): void {
    const running = this.runningCatchUp();
    if (!running?.outstanding.delete(changeSetHash)) {
      return;
    }
    if (pulled) {
      running.pulled += 1;
    }
    this.settleCatchUp();
  }

  private settleCatchUp(): void {
    const catchUp = this.runningCatchUp();
    if (catchUp === null || catchUp.outstanding.size > 0) {
      return;
    }
    catchUp.completedAt = this.now();
    this.logger.info(
      {
        missingAtStart: catchUp.missingAtStart,
        pulled: catchUp.pulled,
        durationMs: catchUp.completedAt - catchUp.startedAt,
      },
      'catch-up completed',
    );
  }

  private clearCatchUpRetries(): void {
    for (const timer of this.catchUpRetries) {
      clearTimeout(timer);
    }
    this.catchUpRetries.clear();
  }

  /**
   * Handles an announced hash: a change set already pending is pulled
   * again right away unless a pull is running, a new one joins the queue.
   */
  private receive(announcement: Announcement): void {
    if (!this.running) {
      return;
    }
    const { changeSetHash } = announcement;
    const pending = this.pending.get(changeSetHash);
    if (pending === undefined) {
      this.pending.set(changeSetHash, {
        fromNodeId: announcement.fromNodeId,
        attempts: 0,
        firstFailedAt: null,
        lastError: null,
      });
    } else {
      pending.fromNodeId ??= announcement.fromNodeId;
    }
    this.enqueue(changeSetHash);
  }

  private enqueue(changeSetHash: string): void {
    if (this.active.has(changeSetHash) || this.queue.includes(changeSetHash)) {
      return;
    }
    this.queue.push(changeSetHash);
    this.drain();
  }

  /**
   * Queues every pending change set again and logs one line for the
   * round: how many are pending, for how long the oldest has been, the
   * most attempts any of them took, and the last error seen.
   */
  private retryPending(): void {
    if (this.pending.size === 0) {
      return;
    }
    let oldestFailedAt = Number.POSITIVE_INFINITY;
    let attemptsMax = 0;
    let lastError: string | null = null;
    for (const [changeSetHash, pending] of this.pending) {
      if (pending.firstFailedAt !== null) {
        oldestFailedAt = Math.min(oldestFailedAt, pending.firstFailedAt);
      }
      attemptsMax = Math.max(attemptsMax, pending.attempts);
      lastError ??= pending.lastError;
      this.enqueue(changeSetHash);
    }
    this.logger.info(
      {
        pending: this.pending.size,
        oldestSinceMs: Number.isFinite(oldestFailedAt)
          ? this.now() - oldestFailedAt
          : 0,
        attemptsMax,
        lastError,
      },
      'pending change sets are pulled again',
    );
  }

  private drain(): void {
    while (this.running && this.active.size < this.concurrency) {
      const changeSetHash = this.queue.shift();
      if (changeSetHash === undefined) {
        return;
      }
      const pull = this.pull(changeSetHash).finally(() => {
        this.active.delete(changeSetHash);
        this.drain();
      });
      this.active.set(changeSetHash, pull);
    }
  }

  private async pull(changeSetHash: string): Promise<void> {
    const pending = this.pending.get(changeSetHash);
    if (pending === undefined) {
      return;
    }
    if (await this.store.holdsChangeSet(changeSetHash)) {
      this.pending.delete(changeSetHash);
      this.counters.skipped += 1;
      this.settled(changeSetHash, false);
      this.logger.debug(
        { changeSetHash, fromNodeId: pending.fromNodeId },
        'change set already held, skipped',
      );
      return;
    }

    pending.attempts += 1;
    const started = this.now();
    const outcome: PullOutcome = {
      changeSetHash,
      fromNodeId: pending.fromNodeId,
      changeSetId: null,
      tables: {},
      started,
    };
    this.notifyTransfer({
      direction: 'incoming',
      peerNodeId: outcome.fromNodeId,
      changeSetHash,
      changeSetId: null,
      tables: {},
      durationMs: 0,
      at: new Date(started).toISOString(),
      status: 'pending',
    });
    try {
      await this.pullChangeSet(
        changeSetHash,
        started + this.pullTimeoutMs,
        outcome,
      );
      this.pending.delete(changeSetHash);
      this.counters.received += 1;
      this.finish(outcome, 'completed');
      this.settled(changeSetHash, true);
      this.logger.info(
        { ...outcome, durationMs: this.now() - started },
        'change set received',
      );
    } catch (error) {
      this.settleFailedPull(pending, outcome, error);
    }
  }

  /**
   * Pulls the change set row, then every item (data rows first), writes
   * them all at once, pulls what they depend on and records the change
   * set. Fills the outcome as it goes, so that a failure reports what was
   * known by then.
   */
  private async pullChangeSet(
    changeSetHash: string,
    deadline: number,
    outcome: PullOutcome,
  ): Promise<void> {
    const changeSet = await this.pullChangeSetRow(changeSetHash, deadline);
    outcome.changeSetId = changeSet.id;
    outcome.tables = countByTable(changeSet.items);
    const received: ReceivedRow[] = [];
    for (const item of dataRowsFirst(changeSet.items)) {
      const row = await this.pullVerified(item.table, item.ref, deadline);
      received.push({ table: item.table, row });
    }
    await this.store.writeReceivedRows(received);
    await this.pullDependencies(received, deadline);
    await this.store.recordReceivedChangeSet(changeSet);
  }

  /**
   * A pull that threw: given up (failed) for a rejected change set, a
   * read the cascade rejected for its hash, or the last allowed attempt;
   * kept pending otherwise. The first failure of a change set is logged
   * as a warning, later ones at debug, and `retryPending` sums them up.
   */
  private settleFailedPull(
    pending: PendingChangeSet,
    outcome: PullOutcome,
    error: unknown,
  ): void {
    const message = errorMessage(error);
    this.lastError = message;
    const givenUp =
      error instanceof ChangeSetRejected ||
      isRejectedByCascade(error) ||
      pending.attempts >= this.maxAttempts;
    const fields = {
      changeSetHash: outcome.changeSetHash,
      changeSetId: outcome.changeSetId,
      fromNodeId: outcome.fromNodeId,
      attempt: pending.attempts,
      err: error,
    };
    if (givenUp) {
      this.pending.delete(outcome.changeSetHash);
      this.counters.failed += 1;
      this.finish(outcome, 'failed', message);
      this.settled(outcome.changeSetHash, false);
      this.logger.error(fields, 'change set failed');
      return;
    }
    pending.firstFailedAt ??= this.now();
    pending.lastError = message;
    this.finish(outcome, 'pending', message);
    const pendingMessage = 'change set pending, will be pulled again';
    if (pending.attempts === 1) {
      this.logger.warn(fields, pendingMessage);
    } else {
      this.logger.debug(fields, pendingMessage);
    }
  }

  private finish(outcome: PullOutcome, status: SyncStatus, error?: string) {
    this.record({
      direction: 'incoming',
      peerNodeId: outcome.fromNodeId,
      changeSetHash: outcome.changeSetHash,
      changeSetId: outcome.changeSetId,
      tables: outcome.tables,
      durationMs: Math.max(0, this.now() - outcome.started),
      at: isoTime(this.now()),
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

  /**
   * The change set row by hash, checked for its shape before anything of
   * it is pulled: a list of items, not more than `maxChangeSetItems`, each
   * naming a table this store has.
   */
  private async pullChangeSetRow(
    changeSetHash: string,
    deadline: number,
  ): Promise<HashedChangeSetRow> {
    const row = await this.pullVerified(
      changeSetsTableCfg.key,
      changeSetHash,
      deadline,
    );
    const items = row.items;
    if (!Array.isArray(items) || !items.every(isChangeSetItem)) {
      throw new ChangeSetRejected(
        changeSetsTableCfg.key,
        changeSetHash,
        'is not a change set with a list of items',
      );
    }
    if (items.length > this.maxChangeSetItems) {
      throw new ChangeSetRejected(
        changeSetsTableCfg.key,
        changeSetHash,
        `names ${items.length} items, more than the ${this.maxChangeSetItems} allowed`,
      );
    }
    const unknown = items.find((item) => !this.tableCfgs.has(item.table));
    if (unknown !== undefined) {
      throw new ChangeSetRejected(
        changeSetsTableCfg.key,
        changeSetHash,
        `names a table this store does not have: "${unknown.table}"`,
      );
    }
    return {
      _hash: row._hash,
      id: typeof row.id === 'string' ? row.id : '',
      items,
    };
  }

  /**
   * One row by hash from the local store or the peers, within the
   * deadline, with its hash checked against its content.
   */
  private async pullVerified(
    table: string,
    hash: string,
    deadline: number,
  ): Promise<SyncRow> {
    const row = await this.within(deadline, `${table}@${hash}`, () =>
      this.store.pullRow(table, hash),
    );
    if (row === undefined) {
      throw new PullIncomplete(`row ${table}@${hash} is not held by any node`);
    }
    return this.verified(table, hash, row);
  }

  private verified(table: string, hash: string, row: SyncRow): SyncRow {
    if (row._hash !== hash) {
      throw new ChangeSetRejected(table, hash, `came back as ${row._hash}`);
    }
    if (!hashMatches(row)) {
      throw new ChangeSetRejected(table, hash, 'does not hash to its content');
    }
    return row;
  }

  /**
   * Pulls, breadth first and up to `dependencyBound` rows, whatever the
   * written rows point at and this node lacks: the rows behind reference
   * columns and the history rows behind `previous`, and what those point
   * at in turn. A dependency that cannot be pulled is logged and left to
   * the change set that will bring it; the change set at hand is complete
   * without it.
   */
  private async pullDependencies(
    written: readonly ReceivedRow[],
    deadline: number,
  ): Promise<void> {
    const walk = new DependencyWalk();
    for (const entry of written) {
      walk.seen.add(`${entry.table}@${entry.row._hash}`);
      walk.add(referencesOf(this.tableCfgs, entry.table, entry.row));
    }

    let pulled = 0;
    for (let next = walk.next(); next !== undefined; next = walk.next()) {
      if (pulled >= this.dependencyBound) {
        this.logger.warn(
          { bound: this.dependencyBound },
          'dependency bound reached, remaining references are left to their own change sets',
        );
        return;
      }
      try {
        const missing = await this.pullMissing(next, deadline);
        if (missing === undefined) {
          continue;
        }
        await this.store.writeReceivedRows([missing]);
        pulled += 1;
        walk.add(referencesOf(this.tableCfgs, missing.table, missing.row));
      } catch (error) {
        this.logger.warn(
          { err: error },
          'a row the received rows point at could not be pulled',
        );
      }
    }
  }

  /**
   * One referenced row or history row, pulled and verified when the
   * local store lacks it; `undefined` when it is there already.
   */
  private async pullMissing(
    reference: RowReference | HistoryReference,
    deadline: number,
  ): Promise<ReceivedRow | undefined> {
    if ('hash' in reference) {
      if (await this.store.hasLocalRow(reference.table, reference.hash)) {
        return undefined;
      }
      const row = await this.pullVerified(
        reference.table,
        reference.hash,
        deadline,
      );
      return { table: reference.table, row };
    }
    if (
      await this.store.hasLocalHistoryRow(reference.table, reference.timeId)
    ) {
      return undefined;
    }
    const table = `${reference.table}InsertHistory`;
    const key = `${table}@${reference.timeId}`;
    const candidate = await this.within(deadline, key, () =>
      this.store.pullHistoryRow(reference.table, reference.timeId),
    );
    if (candidate === undefined) {
      throw new PullIncomplete(`history row ${key} is not held by any node`);
    }
    return { table, row: this.verified(table, candidate._hash, candidate) };
  }

  /**
   * Runs a read with the time left until the deadline; a read that
   * outlives it counts as a peer that did not answer.
   */
  private within<Value>(
    deadline: number,
    what: string,
    read: () => Promise<Value>,
  ): Promise<Value> {
    const remaining = deadline - this.now();
    if (remaining <= 0) {
      return Promise.reject(
        new PullIncomplete(`pull of ${what} exceeded ${this.pullTimeoutMs} ms`),
      );
    }
    return new Promise<Value>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new PullIncomplete(
            `pull of ${what} exceeded ${this.pullTimeoutMs} ms`,
          ),
        );
      }, remaining);
      read().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            new PullIncomplete(
              `pull of ${what} failed: ${errorMessage(error)}`,
            ),
          );
        },
      );
    });
  }

  private record(transfer: SyncTransfer): void {
    this.transfers.unshift(transfer);
    if (this.transfers.length > 10) {
      this.transfers.length = 10;
    }
    this.notifyTransfer(transfer);
  }

  private notifyTransfer(transfer: SyncTransfer): void {
    for (const listener of this.transferListeners) {
      listener(transfer);
    }
  }
}
