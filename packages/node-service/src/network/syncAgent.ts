import type { TableCfg } from '@rljson/rljson';
import {
  changeSetsTableCfg,
  hashMatches,
  type ChangeSetItem,
  type HashedChangeSetRow,
} from '@rljson-tryout/domain';
import type { FastifyBaseLogger } from 'fastify';

import {
  domainTableCfgs,
  type PetShopStore,
  type SyncRow,
} from '../store/petShopStore.ts';
import {
  type Announcement,
  type AnnouncementChannel,
} from './announcementChannel.ts';
import {
  referencesOf,
  type HistoryReference,
  type RowReference,
  type RowReferences,
} from './rowReferences.ts';

/**
 * What the agent needs from the node's store: the event for change sets
 * the store wrote itself, the reads through the network cascade, the
 * local checks and the writes of received rows and change sets.
 */
export type SyncStore = Pick<
  PetShopStore,
  | 'onChangeSetWritten'
  | 'holdsChangeSet'
  | 'hasLocalRow'
  | 'hasLocalHistoryRow'
  | 'pullRow'
  | 'pullHistoryRow'
  | 'writeReceivedRow'
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
 * and slice B13 will stream it as the SSE `sync` event: which way it
 * went, which node it came from or went to (`peerNodeId`: on an incoming
 * transfer the node that wrote the change set, when its announcement
 * said so; on an outgoing one the hub this client announced to, `null`
 * on the hub, which announces to every connected client), the change set
 * by hash and id, how many rows per table it named, how long the pull
 * took, when it finished, and whether it completed, is still pending
 * (the pull could not finish and is retried) or failed for good, with
 * the reason.
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
 * What `/status` reports under `sync` (roadmap section 2.5): how many
 * change sets this node announced, received completely, skipped because
 * it held them already (every seed change set another node announces,
 * since the seed is deterministic), how many are pending and how many
 * failed, the last error, and the last ten transfers, newest first.
 */
export type SyncSnapshot = Readonly<{
  announced: number;
  received: number;
  skipped: number;
  pending: number;
  failed: number;
  lastError: string | null;
  transfers: readonly SyncTransfer[];
}>;

export type SyncAgentOptions = Readonly<{
  /** How long one change set may take to pull, all its rows together. */
  pullTimeoutMs?: number;
  /** How often pending change sets are pulled again. */
  retryIntervalMs?: number;
  /** After how many failed pulls a pending change set counts as failed. */
  maxAttempts?: number;
  /** How many rows a change set may pull in beyond its own items. */
  dependencyBound?: number;
  /** How many change sets are pulled at the same time. */
  concurrency?: number;
  /**
   * When the hub repeats its announcements after a client joined, in
   * milliseconds after the join: once early, once again for a client
   * whose connector was not listening yet the first time.
   */
  replayDelaysMs?: readonly number[];
  now?: () => number;
}>;

type PendingChangeSet = {
  fromNodeId: string | null;
  attempts: number;
};

type WrittenRow = { table: string; row: SyncRow };

/** What a pull knows about itself, for the transfer it ends in. */
type PullOutcome = {
  changeSetHash: string;
  fromNodeId: string | null;
  changeSetId: string | null;
  tables: Record<string, number>;
  started: number;
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
 * A row whose `_hash` does not match its content, or a change set row
 * without a list of items: the change set is dropped for good, since
 * nothing the announcing node serves can be trusted for it (slice D15
 * hardens this further).
 */
class HashMismatch extends Error {
  constructor(table: string, hash: string, reason: string) {
    super(`row ${table}@${hash} ${reason}, skipped`);
    this.name = 'HashMismatch';
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * `IoMulti.readRows` hashes what a peer returned before it caches it
 * locally (`hip` with `throwOnWrongHashes`, `@rljson/io` 0.0.78), so a
 * row whose hash does not match its content fails the read itself, with
 * this message, before it reaches the agent's own check
 * (`docs/findings/change-set-sync.md`). Such a read is not worth
 * repeating.
 */
const isRejectedByCascade = (error: unknown): boolean =>
  errorMessage(error).includes('does not match the newly calculated one');

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

/**
 * The change set synchronisation of roadmap slice D3 and section 3.4.
 *
 * Outgoing: every change set the store writes on its own account (an
 * invoice issued, an animal edited, the seed) is announced by hash on the
 * channel of the current role, and every channel the node gets later
 * hears everything this process wrote again, in write order: a node that
 * seeded before it joined still tells the others what it holds, and a
 * node that announced as a short-lived hub at a cold start (to nobody, or
 * to clients that left with it) tells its next hub too. On the hub the
 * announcements are repeated for every client that joins later as well,
 * because the hub's `Server` forwards an announcement only to the clients
 * connected at that moment. A repeat costs the receivers one lookup each:
 * their connectors drop a reference they received before, and the agent
 * skips a change set it holds.
 *
 * Incoming: for every hash that arrives the agent pulls the change set
 * row through the read cascade of the store, then every row the change
 * set names, verifies each row's hash against its content before it is
 * written, writes it exactly as received and, once every row is there,
 * records the change set locally, which is what makes it count as held.
 * A change set the store already holds is skipped by hash. Rows the
 * received rows point at but this node lacks (a reference to a version
 * from a change set that has not arrived yet, a `previous` of a version
 * from an earlier edit) are pulled too, recursively, up to a bound. A
 * pull whose peer could not answer within `pullTimeoutMs`, or whose rows
 * no node has yet, leaves the change set pending: it is tried again on
 * the next announcement of the same hash and every `retryIntervalMs`,
 * `maxAttempts` times, then counts as failed. A row whose hash does not
 * match fails the change set at once. Several change sets are pulled at
 * a time, `concurrency` of them; the order of arrival is kept for the
 * rest.
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
  private readonly replayDelaysMs: readonly number[];
  private readonly now: () => number;
  private readonly tableCfgs = tableCfgsByKey();

  private channel: AnnouncementChannel | null = null;
  /** Everything the store wrote in this process, in write order. */
  private readonly own: HashedChangeSetRow[] = [];
  private readonly announcedHashes = new Set<string>();
  private readonly pending = new Map<string, PendingChangeSet>();
  private readonly queue: string[] = [];
  private readonly active = new Map<string, Promise<void>>();
  private readonly transfers: SyncTransfer[] = [];
  private readonly counters = {
    announced: 0,
    received: 0,
    skipped: 0,
    failed: 0,
  };
  private lastError: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private replayTimers: NodeJS.Timeout[] = [];
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
    this.replayDelaysMs = options.replayDelaysMs ?? [1_000, 5_000];
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
   * (slice D4) catches up on what it missed.
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
    this.clearReplays();
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
    };
  }

  /**
   * Announces a change set the store wrote on the current channel, or
   * keeps it for the first channel when the node has none.
   */
  private announce(changeSet: HashedChangeSetRow): void {
    this.own.push(changeSet);
    if (this.channel !== null) {
      this.send(this.channel, changeSet);
    }
  }

  /**
   * Sends a change set's hash. The counter and the transfer list record
   * a change set the first time it goes out; a repeat on a later channel
   * or for a client that joined is not a new transfer.
   */
  private send(
    channel: AnnouncementChannel,
    changeSet: HashedChangeSetRow,
  ): void {
    channel.send(changeSet._hash);
    if (this.announcedHashes.has(changeSet._hash)) {
      return;
    }
    this.announcedHashes.add(changeSet._hash);
    this.counters.announced += 1;
    this.record({
      direction: 'outgoing',
      peerNodeId: channel.peerNodeId,
      changeSetHash: changeSet._hash,
      changeSetId: changeSet.id,
      tables: countByTable(changeSet.items),
      durationMs: 0,
      at: new Date(this.now()).toISOString(),
      status: 'completed',
    });
    this.logger.debug(
      {
        changeSetHash: changeSet._hash,
        changeSetId: changeSet.id,
        peerNodeId: channel.peerNodeId,
      },
      'change set announced',
    );
  }

  /**
   * Takes the channel of the current role: listens on it, announces
   * everything this process wrote so far, and on the hub repeats that for
   * every client that joins.
   */
  private attach(channel: AnnouncementChannel | null): void {
    this.clearReplays();
    this.channel = channel;
    if (channel === null) {
      return;
    }
    channel.listen((announcement) => this.receive(announcement));
    channel.onPeerJoined(() => this.scheduleReplays(channel));
    const before = this.counters.announced;
    for (const changeSet of this.own) {
      this.send(channel, changeSet);
    }
    if (this.own.length > 0) {
      this.logger.info(
        {
          count: this.own.length,
          firstTime: this.counters.announced - before,
          peerNodeId: channel.peerNodeId,
        },
        'announced the change sets this node wrote',
      );
    }
  }

  private scheduleReplays(channel: AnnouncementChannel): void {
    for (const delayMs of this.replayDelaysMs) {
      const timer = setTimeout(() => {
        this.replayTimers = this.replayTimers.filter((it) => it !== timer);
        this.replay(channel);
      }, delayMs);
      timer.unref();
      this.replayTimers.push(timer);
    }
  }

  private clearReplays(): void {
    for (const timer of this.replayTimers) {
      clearTimeout(timer);
    }
    this.replayTimers = [];
  }

  /**
   * Repeats every change set this process wrote on the hub's channel, for
   * a client that connected after they went out. Every other client drops
   * the repeats as already received; the new one pulls what it lacks.
   */
  private replay(channel: AnnouncementChannel): void {
    if (this.channel !== channel || this.own.length === 0) {
      return;
    }
    for (const changeSet of this.own) {
      channel.send(changeSet._hash);
    }
    this.logger.info(
      { count: this.own.length },
      'repeated the announcements of this node for a client that joined',
    );
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

  private retryPending(): void {
    for (const changeSetHash of this.pending.keys()) {
      this.enqueue(changeSetHash);
    }
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
    try {
      await this.pullChangeSet(
        changeSetHash,
        started + this.pullTimeoutMs,
        outcome,
      );
      this.pending.delete(changeSetHash);
      this.counters.received += 1;
      this.finish(outcome, 'completed');
      this.logger.info(
        { ...outcome, durationMs: this.now() - started },
        'change set received',
      );
    } catch (error) {
      this.settleFailedPull(pending, outcome, error);
    }
  }

  /**
   * Pulls the change set row, then every item, writes them, pulls what
   * they depend on and records the change set. Fills the outcome as it
   * goes, so that a failure reports what was known by then.
   */
  private async pullChangeSet(
    changeSetHash: string,
    deadline: number,
    outcome: PullOutcome,
  ): Promise<void> {
    const changeSet = await this.pullChangeSetRow(changeSetHash, deadline);
    outcome.changeSetId = changeSet.id;
    const written: WrittenRow[] = [];
    for (const item of changeSet.items) {
      const row = await this.pullVerified(item.table, item.ref, deadline);
      await this.store.writeReceivedRow(item.table, row);
      written.push({ table: item.table, row });
    }
    outcome.tables = countByTable(changeSet.items);
    await this.pullDependencies(written, deadline);
    await this.store.recordReceivedChangeSet(changeSet);
  }

  /**
   * A pull that threw: given up (failed) for a row that does not hash to
   * its content, a read the cascade rejected for its hash, or the last
   * allowed attempt; kept pending otherwise.
   */
  private settleFailedPull(
    pending: PendingChangeSet,
    outcome: PullOutcome,
    error: unknown,
  ): void {
    const message = errorMessage(error);
    this.lastError = message;
    const givenUp =
      error instanceof HashMismatch ||
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
      this.logger.error(fields, 'change set failed');
    } else {
      this.finish(outcome, 'pending', message);
      this.logger.warn(fields, 'change set pending, will be pulled again');
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
      at: new Date(this.now()).toISOString(),
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

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
      throw new HashMismatch(
        changeSetsTableCfg.key,
        changeSetHash,
        'is not a change set with a list of items',
      );
    }
    return {
      _hash: row._hash,
      id: typeof row.id === 'string' ? row.id : '',
      items,
    };
  }

  /**
   * One row by hash through the cascade, within the deadline, with its
   * hash checked against its content.
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
      throw new HashMismatch(table, hash, `came back as ${row._hash}`);
    }
    if (!hashMatches(row)) {
      throw new HashMismatch(table, hash, 'does not hash to its content');
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
    written: readonly WrittenRow[],
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
        await this.store.writeReceivedRow(missing.table, missing.row);
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
  ): Promise<WrittenRow | undefined> {
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
  }
}
