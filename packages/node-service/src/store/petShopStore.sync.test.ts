import { IoMulti, type Io } from '@rljson/io';
import type { Rljson } from '@rljson/rljson';
import {
  currentVersions,
  hashed,
  seedTimeId,
  type EntityRow,
  type VersionHistoryRow,
} from '@rljson-tryout/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  Announcement,
  AnnouncementChannel,
  AnnouncementListener,
} from '../network/announcementChannel.ts';
import { SyncAgent } from '../network/syncAgent.ts';
import { FakeChannelSource } from '../testing/fakeSync.ts';
import { silentLogger } from '../testing/testServer.ts';
import {
  memoryStore,
  storageKinds,
  testStore,
  useTemporaryDataDirectories,
} from '../testing/testStores.ts';
import { domainTableCfgs, type PetShopStore } from './petShopStore.ts';

const dataDirectories = useTemporaryDataDirectories();

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const until = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

type StoredRow = { _hash: string } & Record<string, unknown>;

/** Every table of the store as rows sorted by hash, keyed by table. */
const contentOf = async (
  store: PetShopStore,
): Promise<Record<string, StoredRow[]>> => {
  const content: Record<string, StoredRow[]> = {};
  for (const tableCfg of domainTableCfgs) {
    for (const table of [tableCfg.key, `${tableCfg.key}InsertHistory`]) {
      const rljson = await store.localIo.readRows({ table, where: {} });
      content[table] = [...(rljson[table]._data as StoredRow[])].sort(
        (left, right) => left._hash.localeCompare(right._hash),
      );
    }
  }
  return content;
};

/**
 * The hashes per table, without the history rows of the change sets:
 * those stay per node (a received change set gets a history row of its
 * own, stamped by the receiver), so two synchronised stores agree on
 * every other table and on the number of those.
 */
const hashesOf = (content: Record<string, StoredRow[]>) =>
  Object.fromEntries(
    Object.entries(content)
      .filter(([table]) => table !== 'changeSetsInsertHistory')
      .map(([table, rows]) => [table, rows.map((row) => row._hash)]),
  );

/**
 * A channel that hands every announcement straight to the other node's
 * agent, the way the hub relays it, with the announcing node's id.
 */
class LinkedChannel implements AnnouncementChannel {
  readonly peerNodeId: string | null;
  private readonly nodeId: string;
  private other: LinkedChannel | null = null;
  private listener: AnnouncementListener | null = null;

  constructor(nodeId: string, peerNodeId: string | null) {
    this.nodeId = nodeId;
    this.peerNodeId = peerNodeId;
  }

  link(other: LinkedChannel): void {
    this.other = other;
  }

  send(changeSetHash: string): void {
    this.other?.deliver({ changeSetHash, fromNodeId: this.nodeId });
  }

  listen(listener: AnnouncementListener): void {
    this.listener = listener;
  }

  onPeerJoined(): void {}

  deliver(announcement: Announcement): void {
    this.listener?.(announcement);
  }
}

/**
 * Two nodes in this process: each store reads through a cascade into the
 * other (the local store first, the other read-only behind it, as the
 * `Client` and `Server` multis of `@rljson/server` are built), and each
 * agent announces to the other over a linked channel.
 */
const linkedNodes = async (first: PetShopStore, second: PetShopStore) => {
  const cascadeInto = async (own: Io, other: Io): Promise<IoMulti> => {
    const cascade = new IoMulti([
      { io: own, priority: 1, read: true, write: true, dump: true },
      { io: other, priority: 2, read: true, write: false, dump: false },
    ]);
    await cascade.init();
    return cascade;
  };
  const firstCascade = await cascadeInto(first.localIo, second.localIo);
  const secondCascade = await cascadeInto(second.localIo, first.localIo);
  first.readThrough(() => firstCascade);
  second.readThrough(() => secondCascade);
  const firstChannel = new LinkedChannel('first', 'second');
  const secondChannel = new LinkedChannel('second', 'first');
  firstChannel.link(secondChannel);
  secondChannel.link(firstChannel);
  const agentOver = (store: PetShopStore, channel: LinkedChannel) => {
    const channels = new FakeChannelSource();
    const agent = new SyncAgent(store, channels, silentLogger(), {
      retryIntervalMs: 100,
      pullTimeoutMs: 5_000,
    });
    agent.start();
    cleanups.push(() => agent.stop());
    channels.publish(channel);
    return agent;
  };
  return {
    firstAgent: agentOver(first, firstChannel),
    secondAgent: agentOver(second, secondChannel),
    firstChannel,
    secondChannel,
  };
};

/** Announces every change set the store holds to the other node. */
const announceAll = async (
  store: PetShopStore,
  channel: LinkedChannel,
): Promise<number> => {
  const rljson = await store.localIo.readRows({
    table: 'changeSets',
    where: {},
  });
  const hashes = (rljson.changeSets._data as { _hash: string }[]).map(
    (row) => row._hash,
  );
  for (const hash of hashes) {
    channel.send(hash);
  }
  return hashes.length;
};

/** The ids with more than one tip, per entity table. */
const conflictsOf = async (
  store: PetShopStore,
): Promise<Record<string, string[]>> => {
  const conflicts: Record<string, string[]> = {};
  for (const tableCfg of domainTableCfgs) {
    if (tableCfg.key === 'changeSets') {
      continue;
    }
    const rows = (
      await store.localIo.readRows({ table: tableCfg.key, where: {} })
    )[tableCfg.key]._data as EntityRow[];
    const history = (
      await store.localIo.readRows({
        table: `${tableCfg.key}InsertHistory`,
        where: {},
      })
    )[`${tableCfg.key}InsertHistory`]._data as VersionHistoryRow[];
    const { conflictingIds } = currentVersions(rows, history, tableCfg.key);
    if (conflictingIds.size > 0) {
      conflicts[tableCfg.key] = [...conflictingIds].sort();
    }
  }
  return conflicts;
};

describe('the deterministic seed', () => {
  it('writes identical rows, history rows and change sets into two stores of the same size', async () => {
    const first = await memoryStore();
    const second = await memoryStore();
    cleanups.push(
      () => first.close(),
      () => second.close(),
    );

    await first.seedIfEmpty('small');
    await second.seedIfEmpty('small');

    const firstContent = await contentOf(first);
    expect(firstContent).toStrictEqual(await contentOf(second));
    expect(firstContent.changeSets).toHaveLength(44);
    expect(firstContent.changeSetsInsertHistory).toHaveLength(44);
    for (const row of firstContent.animalsInsertHistory!) {
      expect(row.timeId).toMatch(/^\d+:seed$/);
      expect(row).toMatchObject({ origin: 'seed', previous: [] });
    }
  });

  it.each(storageKinds)(
    'writes the same hashes over the %s store as over the in-memory one',
    async (storage) => {
      const memory = await memoryStore();
      const other = await testStore({
        storage,
        dataDirectory: dataDirectories.next(),
      });
      cleanups.push(
        () => memory.close(),
        () => other.close(),
      );

      await memory.seedIfEmpty('small');
      await other.seedIfEmpty('small');

      expect(hashesOf(await contentOf(other))).toStrictEqual(
        hashesOf(await contentOf(memory)),
      );
    },
  );

  it('makes the small seed a prefix of the medium seed', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');

    const smallContent = await contentOf(small);
    const mediumContent = await contentOf(medium);
    for (const [table, rows] of Object.entries(smallContent)) {
      const mediumHashes = new Set(
        mediumContent[table]!.map((row) => row._hash),
      );
      for (const row of rows) {
        expect(mediumHashes.has(row._hash)).toBe(true);
      }
    }
    expect(mediumContent.changeSets!.length).toBeGreaterThan(
      smallContent.changeSets!.length,
    );
    expect(
      mediumContent.changeSetsInsertHistory!.map((row) => row.timeId),
    ).toContain(seedTimeId(1));
  });
});

describe('synchronising a small and a medium store both ways', () => {
  it('ends with the union on both, no entity with two tips and every change set held once', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');
    const mediumBefore = await contentOf(medium);
    const { firstAgent, secondAgent, firstChannel, secondChannel } =
      await linkedNodes(small, medium);

    const fromSmall = await announceAll(small, firstChannel);
    const fromMedium = await announceAll(medium, secondChannel);
    await until(
      () =>
        firstAgent.snapshot().pending === 0 &&
        secondAgent.snapshot().pending === 0 &&
        firstAgent.snapshot().received + firstAgent.snapshot().skipped ===
          fromMedium &&
        secondAgent.snapshot().received + secondAgent.snapshot().skipped ===
          fromSmall,
    );

    expect(secondAgent.snapshot()).toMatchObject({
      received: 0,
      skipped: fromSmall,
      failed: 0,
      lastError: null,
    });
    expect(firstAgent.snapshot()).toMatchObject({
      received: fromMedium - fromSmall,
      skipped: fromSmall,
      failed: 0,
      lastError: null,
    });
    expect(await contentOf(medium)).toStrictEqual(mediumBefore);
    const smallAfter = await contentOf(small);
    expect(hashesOf(smallAfter)).toStrictEqual(hashesOf(mediumBefore));
    expect(smallAfter.changeSetsInsertHistory).toHaveLength(
      mediumBefore.changeSetsInsertHistory!.length,
    );
    expect(await conflictsOf(small)).toStrictEqual({});
    expect(await conflictsOf(medium)).toStrictEqual({});
    expect(await small.tableRowCounts()).toStrictEqual(
      await medium.tableRowCounts(),
    );
    expect((await small.listAnimals({}, { limit: 200, offset: 0 })).total).toBe(
      110,
    );
    expect(await small.listInvoices()).toStrictEqual(
      await medium.listInvoices(),
    );
    for (const hash of smallAfter.changeSets!.map((row) => row._hash)) {
      expect(await small.holdsChangeSet(hash)).toBe(true);
    }
  }, 60_000);

  it('brings an edit made on one side to the other as the current version, chained to the seed version', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');
    await linkedNodes(small, medium);

    const renamed = (await medium.updateAnimal('bowser-the-guard-dog', {
      name: 'Bowser the Retired Guard Dog',
    }))!;
    await until(
      async () =>
        (await small.getAnimal('bowser-the-guard-dog'))?.hash === renamed.hash,
    );

    const history = (await small.getAnimalHistory('bowser-the-guard-dog'))!;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      hash: renamed.hash,
      current: true,
      previous: [history[1]!.timeId],
    });
    expect(history[1]!.timeId).toMatch(/:seed$/);
    expect(await conflictsOf(small)).toStrictEqual({});
  });
});

describe('the store primitives of the synchronisation', () => {
  it('holds a change set once its history row exists, not on the row alone', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    const changeSet = hashed({ id: 'x', items: [] });

    expect(await store.holdsChangeSet(changeSet._hash)).toBe(false);
    await store.writeReceivedRow('changeSets', changeSet);
    expect(await store.holdsChangeSet(changeSet._hash)).toBe(false);
    await store.recordReceivedChangeSet(changeSet);
    expect(await store.holdsChangeSet(changeSet._hash)).toBe(true);
    expect(await store.holdsChangeSet("x' OR '1'='1")).toBe(false);
  });

  it('does not announce a received change set', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    const announced: string[] = [];
    store.onChangeSetWritten((changeSet) => announced.push(changeSet.id));
    const changeSet = hashed({ id: 'received', items: [] });

    await store.recordReceivedChangeSet(changeSet);
    await store
      .issueInvoice({
        customerId: 'scrooge-mcduck',
        items: [{ animalId: 'donald-the-third', quantity: 1 }],
      })
      .catch(() => undefined);

    expect(announced).toStrictEqual([]);
  });

  it('reads a row through the cascade and lands it locally, and answers undefined for what nobody has', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');
    await linkedNodes(small, medium);
    const generatedAnimal = (
      await medium.listAnimals({}, { limit: 200, offset: 0 })
    ).items.find((animal) => animal.id.endsWith('-1'))!;

    expect(await small.hasLocalRow('animals', generatedAnimal.hash)).toBe(
      false,
    );
    const pulled = await small.pullRow('animals', generatedAnimal.hash);

    expect(pulled).toMatchObject({ _hash: generatedAnimal.hash });
    expect(await small.hasLocalRow('animals', generatedAnimal.hash)).toBe(true);
    expect(await small.pullRow('animals', 'NoSuchHash0123456789ab')).toBe(
      undefined,
    );
    expect(await small.pullRow('nobody', generatedAnimal.hash)).toBe(undefined);
    expect(await small.pullRow('animals', 'a b')).toBe(undefined);
    expect(await small.hasLocalRow('nobody', generatedAnimal.hash)).toBe(false);
  });

  it('reads a history row by timeId through the cascade', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');
    await linkedNodes(small, medium);
    const renamed = (await medium.updateAnimal('bowser-the-guard-dog', {
      name: 'Bowser II',
    }))!;
    const [version] = (await medium.getAnimalHistory('bowser-the-guard-dog'))!;

    expect(await small.hasLocalHistoryRow('animals', version!.timeId)).toBe(
      false,
    );
    const pulled = await small.pullHistoryRow('animals', version!.timeId);

    expect(pulled).toMatchObject({
      animalsRef: renamed.hash,
      timeId: version!.timeId,
    });
    expect(await small.hasLocalHistoryRow('animals', version!.timeId)).toBe(
      true,
    );
    expect(await small.pullHistoryRow('animals', '1:nope')).toBe(undefined);
    expect(await small.pullHistoryRow('animals', 'not a timeId')).toBe(
      undefined,
    );
    expect(await small.pullHistoryRow('nobody', '1:abcd')).toBe(undefined);
    expect(await small.hasLocalHistoryRow('animals', 'not a timeId')).toBe(
      false,
    );
  });

  it('throws when the cascade cannot answer a pull', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    await store.seedIfEmpty();
    const failing: Io = {
      ...store.localIo,
      readRows: () => Promise.reject(new Error('Io "io-1" is closed')),
    };
    store.readThrough(() => failing);

    await expect(store.pullRow('animals', 'SomeHash')).rejects.toThrow(
      'Io "io-1" is closed',
    );
  });

  it('writes a received row as it is and refuses a tampered one or an unknown table', async () => {
    const store = await memoryStore();
    cleanups.push(() => store.close());
    await store.seedIfEmpty();
    const animal = (await store.getAnimal('bowser-the-guard-dog'))!;
    const row = (await store.pullRow('animals', animal.hash))!;
    const before = await store.tableRowCounts();

    await store.writeReceivedRow('animals', row);
    expect(await store.tableRowCounts()).toStrictEqual(before);
    await expect(
      store.writeReceivedRow('animals', { ...row, name: 'Tampered' }),
    ).rejects.toThrow('does not match');
    await expect(
      store.writeReceivedRow('nobody', { _hash: 'x' }),
    ).rejects.toThrow('This store has no table "nobody".');
    expect(await store.tableRowCounts()).toStrictEqual(before);
  });

  it('keeps the whole-table reads local and validates as one document after a sync', async () => {
    const small = await memoryStore();
    const medium = await memoryStore();
    cleanups.push(
      () => small.close(),
      () => medium.close(),
    );
    await small.seedIfEmpty('small');
    await medium.seedIfEmpty('medium');
    await linkedNodes(small, medium);

    const listed = await small.listAnimals({}, { limit: 200, offset: 0 });

    expect(listed.total).toBe(10);
    const dump: Rljson = await small.localIo.dump();
    expect(dump.animals._data).toHaveLength(10);
  });
});
