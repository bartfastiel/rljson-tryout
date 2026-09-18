import { hashed, type HashedChangeSetRow } from '@rljson-tryout/domain';

import type {
  Announcement,
  AnnouncementChannel,
  AnnouncementListener,
  AttachedPeer,
  PeerListener,
} from '../network/announcementChannel.ts';
import type { ChannelSource, SyncStore } from '../network/syncAgent.ts';
import type {
  ChangeSetListener,
  HeldChangeSet,
  ReceivedRow,
  SyncRow,
} from '../store/petShopStore.ts';

/**
 * An `AnnouncementChannel` for the agent's unit tests: records what the
 * agent sends, lets a test deliver announcements and attach a peer whose
 * held change sets the test dictates.
 */
export class FakeChannel implements AnnouncementChannel {
  readonly sent: string[] = [];
  readonly peerNodeId: string | null;
  private listener: AnnouncementListener | null = null;
  private readonly peerListeners: PeerListener[] = [];

  constructor(peerNodeId: string | null = 'hub-node') {
    this.peerNodeId = peerNodeId;
  }

  send(changeSetHash: string): void {
    this.sent.push(changeSetHash);
  }

  listen(listener: AnnouncementListener): void {
    this.listener = listener;
  }

  onPeerAttached(listener: PeerListener): void {
    this.peerListeners.push(listener);
  }

  deliver(announcement: Announcement): void {
    if (this.listener === null) {
      throw new Error('nobody listens on this channel');
    }
    this.listener(announcement);
  }

  /**
   * Attaches a peer that holds the given change sets, in that order, or
   * whose list cannot be read when `heldChangeSets` is given.
   */
  attachPeer(
    nodeId: string | null,
    held: readonly HeldChangeSet[] | (() => Promise<readonly HeldChangeSet[]>),
  ): AttachedPeer {
    const peer: AttachedPeer = {
      nodeId,
      heldChangeSets:
        typeof held === 'function' ? held : () => Promise.resolve(held),
    };
    for (const listener of this.peerListeners) {
      listener(peer);
    }
    return peer;
  }
}

/**
 * A `ChannelSource` for the agent's unit tests: hands out whatever
 * channel a test sets, `null` at first.
 */
export class FakeChannelSource implements ChannelSource {
  private readonly listeners = new Set<
    (channel: AnnouncementChannel | null) => void
  >();
  private channel: AnnouncementChannel | null = null;

  subscribe(listener: (channel: AnnouncementChannel | null) => void) {
    this.listeners.add(listener);
    listener(this.channel);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(channel: AnnouncementChannel | null): void {
    this.channel = channel;
    for (const listener of this.listeners) {
      listener(channel);
    }
  }
}

type PullBehaviour = (
  table: string,
  key: string,
) => Promise<SyncRow | undefined> | SyncRow | undefined;

/**
 * A `SyncStore` for the agent's unit tests: the "network" is a map of
 * rows by table and hash (plus history rows by `timeId`) a test fills,
 * the local store a second map that records what the agent wrote; every
 * pull can be intercepted to fail or hang. The change sets it holds are
 * listed in the order they were written or recorded, each stamped with
 * the next `timeId` of a counter.
 */
export class FakeSyncStore implements SyncStore {
  readonly remote = new Map<string, SyncRow>();
  readonly local = new Map<string, SyncRow>();
  readonly recorded: HashedChangeSetRow[] = [];
  readonly pulls: string[] = [];
  /** The keys of every write, one entry per `writeReceivedRows` call. */
  readonly writes: string[][] = [];
  private readonly held: HeldChangeSet[] = [];
  private readonly changeSetListeners = new Set<ChangeSetListener>();
  private behaviour: PullBehaviour | null = null;
  private nextTimeId = 1_700_000_000_000;

  /** A key of the maps: `<table>@<hash>`. */
  static key(table: string, hash: string): string {
    return `${table}@${hash}`;
  }

  /** Puts rows on the network, as another node would hold them. */
  serve(table: string, ...rows: SyncRow[]): void {
    for (const row of rows) {
      this.remote.set(FakeSyncStore.key(table, row._hash), row);
    }
  }

  /** Replaces every pull with the given behaviour, or restores the map. */
  onPull(behaviour: PullBehaviour | null): void {
    this.behaviour = behaviour;
  }

  /**
   * What a test's store "writes itself", announced to the agent with the
   * given entity ids.
   */
  writeOwnChangeSet(
    id: string,
    items: HashedChangeSetRow['items'],
    entityIds: readonly string[] = [],
  ) {
    const changeSet = hashed({ id, items });
    this.hold(changeSet);
    for (const listener of this.changeSetListeners) {
      listener(changeSet, entityIds);
    }
    return changeSet;
  }

  private hold(changeSet: HashedChangeSetRow): void {
    this.local.set(FakeSyncStore.key('changeSets', changeSet._hash), changeSet);
    this.local.set(`changeSetsInsertHistory@${changeSet._hash}`, {
      _hash: `history-of-${changeSet._hash}`,
      changeSetsRef: changeSet._hash,
    });
    this.nextTimeId += 1;
    this.held.push({
      hash: changeSet._hash,
      timeId: `${this.nextTimeId}:fake`,
    });
  }

  onChangeSetWritten(listener: ChangeSetListener): () => void {
    this.changeSetListeners.add(listener);
    return () => {
      this.changeSetListeners.delete(listener);
    };
  }

  async holdsChangeSet(hash: string): Promise<boolean> {
    return this.local.has(`changeSetsInsertHistory@${hash}`);
  }

  async heldChangeSets(): Promise<HeldChangeSet[]> {
    return [...this.held];
  }

  async localChangeSet(hash: string): Promise<HashedChangeSetRow | undefined> {
    return this.local.get(FakeSyncStore.key('changeSets', hash)) as
      HashedChangeSetRow | undefined;
  }

  async hasLocalRow(table: string, hash: string): Promise<boolean> {
    return this.local.has(FakeSyncStore.key(table, hash));
  }

  async hasLocalHistoryRow(table: string, timeId: string): Promise<boolean> {
    return [...this.local.entries()].some(
      ([key, row]) =>
        key.startsWith(`${table}InsertHistory@`) && row.timeId === timeId,
    );
  }

  async pullRow(table: string, hash: string): Promise<SyncRow | undefined> {
    this.pulls.push(FakeSyncStore.key(table, hash));
    if (this.behaviour !== null) {
      return this.behaviour(table, hash);
    }
    return (
      this.local.get(FakeSyncStore.key(table, hash)) ??
      this.remote.get(FakeSyncStore.key(table, hash))
    );
  }

  async pullHistoryRow(
    table: string,
    timeId: string,
  ): Promise<SyncRow | undefined> {
    this.pulls.push(`${table}InsertHistory@timeId:${timeId}`);
    if (this.behaviour !== null) {
      return this.behaviour(`${table}InsertHistory`, timeId);
    }
    return [...this.remote.entries()].find(
      ([key, row]) =>
        key.startsWith(`${table}InsertHistory@`) && row.timeId === timeId,
    )?.[1];
  }

  async writeReceivedRows(rows: readonly ReceivedRow[]): Promise<void> {
    this.writes.push(
      rows.map(({ table, row }) => FakeSyncStore.key(table, row._hash)),
    );
    for (const { table, row } of rows) {
      this.local.set(FakeSyncStore.key(table, row._hash), row);
    }
  }

  async recordReceivedChangeSet(changeSet: HashedChangeSetRow): Promise<void> {
    this.recorded.push(changeSet);
    this.hold(changeSet);
  }
}
