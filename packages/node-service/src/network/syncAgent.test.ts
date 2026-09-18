import {
  hashed,
  seedTimeId,
  type HashedChangeSetRow,
} from '@rljson-tryout/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { SyncRow } from '../store/petShopStore.ts';
import {
  FakeChannel,
  FakeChannelSource,
  FakeSyncStore,
} from '../testing/fakeSync.ts';
import { recordingLogger } from '../testing/recordingLogger.ts';
import { SyncAgent, type SyncAgentOptions } from './syncAgent.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const until = async (
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 30));

/**
 * An agent over a fake store and a fake channel source, started, with
 * short timings.
 */
const agentOverFakes = (options: SyncAgentOptions = {}) => {
  const store = new FakeSyncStore();
  const channels = new FakeChannelSource();
  const { logger, records } = recordingLogger();
  const agent = new SyncAgent(store, channels, logger, {
    pullTimeoutMs: 300,
    retryIntervalMs: 50,
    maxAttempts: 3,
    ...options,
  });
  agent.start();
  cleanups.push(() => agent.stop());
  return { store, channels, agent, records };
};

/**
 * An animal version with its history row and the change set naming both,
 * as another node would serve them: the rows go onto the fake network,
 * the change set hash is what the test announces.
 */
const remoteAnimalVersion = (
  store: FakeSyncStore,
  name: string,
  options: { previous?: string[]; timeId?: string; speciesRef?: string } = {},
): {
  changeSet: HashedChangeSetRow;
  animal: SyncRow;
  history: SyncRow;
} => {
  const animal = hashed({
    id: 'bowser-the-guard-dog',
    name,
    speciesRef: options.speciesRef ?? 'species-dog-hash',
    breederRef: 'breeder-hash',
    bornOn: '2020-01-01',
    priceCents: 1000,
    backgroundStory: 'A guard dog.',
    traitsRefs: ['trait-loyal-hash'],
  });
  const history = hashed({
    animalsRef: animal._hash,
    timeId: options.timeId ?? `${Date.now()}:abcd`,
    route: '/animals',
    origin: 'db.insert',
    previous: options.previous ?? [],
  });
  const changeSet = hashed({
    id: `update-animal-bowser-${history.timeId}`,
    items: [
      { table: 'animals', ref: animal._hash },
      { table: 'animalsInsertHistory', ref: history._hash },
    ],
  });
  store.serve('animals', animal);
  store.serve('animalsInsertHistory', history);
  store.serve('changeSets', changeSet);
  return { changeSet, animal, history };
};

/** The referenced rows every animal version above points at, held locally. */
const holdReferencedRows = (store: FakeSyncStore): void => {
  store.local.set('species@species-dog-hash', { _hash: 'species-dog-hash' });
  store.local.set('breeders@breeder-hash', { _hash: 'breeder-hash' });
  store.local.set('traits@trait-loyal-hash', { _hash: 'trait-loyal-hash' });
};

/** The held list a peer reports for the given change sets, in that order. */
const heldByPeer = (
  changeSets: readonly HashedChangeSetRow[],
  firstMilliseconds = 1_800_000_000_000,
) =>
  changeSets.map((changeSet, index) => ({
    hash: changeSet._hash,
    timeId: `${firstMilliseconds + index}:peer`,
  }));

describe('SyncAgent announcing', () => {
  it('announces a change set written while the channel is up right away', () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);

    const changeSet = store.writeOwnChangeSet('live', [
      { table: 'animals', ref: 'a' },
      { table: 'animalsInsertHistory', ref: 'b' },
    ]);

    expect(channel.sent).toStrictEqual([changeSet._hash]);
    expect(agent.snapshot()).toMatchObject({ announced: 1, pending: 0 });
    expect(agent.snapshot().transfers).toStrictEqual([
      expect.objectContaining({
        direction: 'outgoing',
        peerNodeId: 'hub-node',
        changeSetHash: changeSet._hash,
        changeSetId: 'live',
        tables: { animals: 1, animalsInsertHistory: 1 },
        status: 'completed',
      }),
    ]);
  });

  it('keeps nothing for a change set written without a channel; the catch-up announces it to a peer that lacks it, in write order', async () => {
    const { store, channels, agent } = agentOverFakes();
    const first = store.writeOwnChangeSet('first', []);
    const second = store.writeOwnChangeSet('second', []);
    expect(agent.snapshot().announced).toBe(0);
    const channel = new FakeChannel('hub-node');
    channels.publish(channel);
    expect(channel.sent).toStrictEqual([]);

    channel.attachPeer('hub-node', []);
    await until(() => channel.sent.length === 2);

    expect(channel.sent).toStrictEqual([first._hash, second._hash]);
    expect(agent.snapshot()).toMatchObject({ announced: 2, pending: 0 });
    expect(
      agent.snapshot().transfers.map((it) => it.changeSetId),
    ).toStrictEqual(['second', 'first']);
  });

  it('announces a change set again to a peer that lacks it, counting it once', async () => {
    const { store, channels, agent } = agentOverFakes();
    const first = new FakeChannel('hub-a');
    channels.publish(first);
    const connected = store.writeOwnChangeSet('while-connected', []);
    channels.publish(null);
    const offline = store.writeOwnChangeSet('while-offline', []);
    const second = new FakeChannel('hub-b');
    channels.publish(second);

    second.attachPeer('hub-b', heldByPeer([connected]));
    await until(() => second.sent.length === 1);
    second.attachPeer('client-c', []);
    await until(() => second.sent.length === 3);

    expect(first.sent).toStrictEqual([connected._hash]);
    expect(second.sent).toStrictEqual([
      offline._hash,
      connected._hash,
      offline._hash,
    ]);
    expect(agent.snapshot().announced).toBe(2);
    expect(agent.snapshot().transfers).toHaveLength(2);
  });

  it('ignores a peer attached on a channel it left', async () => {
    const { store, channels } = agentOverFakes();
    const first = new FakeChannel(null);
    channels.publish(first);
    const onFirst = store.writeOwnChangeSet('on-first', []);
    channels.publish(new FakeChannel(null));

    first.attachPeer('late', []);
    await settle();

    expect(first.sent).toStrictEqual([onFirst._hash]);
  });

  it('keeps announcing nothing after stop', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    await agent.stop();

    store.writeOwnChangeSet('after-stop', []);

    expect(channel.sent).toStrictEqual([]);
  });
});

describe('SyncAgent remembering transfers', () => {
  it('lists ten in the snapshot and keeps fifty behind them, newest first', () => {
    const { store, channels, agent } = agentOverFakes();
    channels.publish(new FakeChannel(null));

    for (let index = 0; index < 60; index += 1) {
      store.writeOwnChangeSet(`own-${index}`, []);
    }

    const listed = agent.snapshot().transfers;
    expect(listed).toHaveLength(10);
    expect(listed[0]!.changeSetId).toBe('own-59');
    expect(listed[9]!.changeSetId).toBe('own-50');
    const kept = agent.transfers({ limit: 100 });
    expect(kept).toHaveLength(50);
    expect(kept[0]!.changeSetId).toBe('own-59');
    expect(kept[49]!.changeSetId).toBe('own-10');
    expect(
      agent.transfers({ limit: 3 }).map((it) => it.changeSetId),
    ).toStrictEqual(['own-59', 'own-58', 'own-57']);
    expect(agent.transfers({ limit: 0 })).toStrictEqual([]);
  });

  it('lists the transfers with one partner: the ones naming it and the announcements to every client', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const asHub = new FakeChannel(null);
    channels.publish(asHub);
    const broadcast = store.writeOwnChangeSet('to-everyone', []);
    const fromNode2 = remoteAnimalVersion(store, 'From node2', {
      timeId: '1000:aaaa',
    });
    const fromNode3 = remoteAnimalVersion(store, 'From node3', {
      timeId: '1001:bbbb',
    });
    asHub.deliver({
      changeSetHash: fromNode2.changeSet._hash,
      fromNodeId: 'node2',
    });
    await until(() => agent.snapshot().received === 1);
    asHub.deliver({
      changeSetHash: fromNode3.changeSet._hash,
      fromNodeId: 'node3',
    });
    await until(() => agent.snapshot().received === 2);
    const asClient = new FakeChannel('node3');
    channels.publish(asClient);
    const toHub = store.writeOwnChangeSet('to-the-hub', []);

    const withNode2 = agent.transfers({ peerNodeId: 'node2', limit: 10 });
    expect(
      withNode2.map((it) => `${it.direction} ${it.changeSetHash}`),
    ).toStrictEqual([
      `incoming ${fromNode2.changeSet._hash}`,
      `outgoing ${broadcast._hash}`,
    ]);
    const withNode3 = agent.transfers({ peerNodeId: 'node3', limit: 10 });
    expect(
      withNode3.map((it) => `${it.direction} ${it.changeSetHash}`),
    ).toStrictEqual([
      `outgoing ${toHub._hash}`,
      `incoming ${fromNode3.changeSet._hash}`,
      `outgoing ${broadcast._hash}`,
    ]);
    expect(agent.transfers({ peerNodeId: 'node3', limit: 1 })).toStrictEqual([
      withNode3[0],
    ]);
    expect(agent.transfers({ peerNodeId: 'node4', limit: 10 })).toStrictEqual([
      withNode2[1],
    ]);
  });
});

describe('SyncAgent catching up', () => {
  it('starts with no catch-up', () => {
    const { agent } = agentOverFakes();

    expect(agent.snapshot().catchUp).toStrictEqual({
      lastStartedAt: null,
      lastCompletedAt: null,
      missingAtStart: 0,
      pulled: 0,
      durationMs: null,
    });
  });

  it('pulls what the peer holds and this node lacks, in the order the peer learned about them, from that peer', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const held = store.writeOwnChangeSet('held-here-too', []);
    const channel = new FakeChannel();
    channels.publish(channel);
    const versions = ['One', 'Two', 'Three'].map((name, index) =>
      remoteAnimalVersion(store, name, { timeId: `${1000 + index}:abcd` }),
    );
    // The peer lists them youngest first; the agent follows its time ids.
    const peerList = [
      { hash: versions[2]!.changeSet._hash, timeId: '1800000000002:peer' },
      { hash: versions[0]!.changeSet._hash, timeId: '1800000000000:peer' },
      { hash: held._hash, timeId: '1700000000000:peer' },
      { hash: versions[1]!.changeSet._hash, timeId: '1800000000001:peer' },
    ];

    channel.attachPeer('node2', peerList);
    await until(() => agent.snapshot().catchUp.lastCompletedAt !== null);

    expect(store.recorded.map((changeSet) => changeSet.id)).toStrictEqual(
      versions.map((version) => version.changeSet.id),
    );
    expect(agent.snapshot()).toMatchObject({
      received: 3,
      skipped: 0,
      pending: 0,
      announced: 0,
      failed: 0,
      catchUp: { missingAtStart: 3, pulled: 3 },
    });
    expect(channel.sent).toStrictEqual([]);
    for (const transfer of agent.snapshot().transfers) {
      expect(transfer).toMatchObject({
        direction: 'incoming',
        peerNodeId: 'node2',
        status: 'completed',
      });
    }
    const { catchUp } = agent.snapshot();
    expect(catchUp.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(catchUp.lastCompletedAt!)).toBeGreaterThanOrEqual(
      Date.parse(catchUp.lastStartedAt!),
    );
  });

  it('announces what this node holds and the peer lacks, to that peer', async () => {
    const { store, channels, agent } = agentOverFakes();
    const shared = store.writeOwnChangeSet('shared', []);
    const mine = store.writeOwnChangeSet('mine', [
      { table: 'invoices', ref: 'i' },
    ]);
    const channel = new FakeChannel(null);
    channels.publish(channel);

    channel.attachPeer('client-a', heldByPeer([shared]));
    await until(() => channel.sent.length === 1);

    expect(channel.sent).toStrictEqual([mine._hash]);
    expect(agent.snapshot()).toMatchObject({
      announced: 1,
      received: 0,
      catchUp: { missingAtStart: 0, pulled: 0 },
    });
    expect(agent.snapshot().transfers[0]).toMatchObject({
      direction: 'outgoing',
      peerNodeId: 'client-a',
      changeSetId: 'mine',
      tables: { invoices: 1 },
    });
    expect(agent.snapshot().catchUp.lastCompletedAt).not.toBeNull();
  });

  it('does nothing for a peer that holds the same change sets, and completes at once', async () => {
    const { store, channels, agent, records } = agentOverFakes();
    const changeSets = [
      store.writeOwnChangeSet('a', []),
      store.writeOwnChangeSet('b', []),
    ];
    const channel = new FakeChannel();
    channels.publish(channel);

    channel.attachPeer('hub-node', heldByPeer(changeSets));
    await until(() => agent.snapshot().catchUp.lastCompletedAt !== null);

    expect(channel.sent).toStrictEqual([]);
    expect(store.pulls).toStrictEqual([]);
    expect(agent.snapshot()).toMatchObject({
      announced: 0,
      received: 0,
      skipped: 0,
      catchUp: { missingAtStart: 0, pulled: 0 },
    });
    expect(agent.snapshot().catchUp.durationMs).toBeLessThan(1_000);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'catch-up started',
        fields: expect.objectContaining({
          peerNodeId: 'hub-node',
          peerHolds: 2,
          holds: 2,
          missing: 0,
          announced: 0,
        }) as Record<string, unknown>,
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ level: 'info', message: 'catch-up completed' }),
    );
  });

  it('adds what a second peer holds to the catch-up still running', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel(null);
    channels.publish(channel);
    const one = remoteAnimalVersion(store, 'One', { timeId: '1001:abcd' });
    const two = remoteAnimalVersion(store, 'Two', { timeId: '1002:abcd' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.onPull(async (table, key) => {
      await gate;
      return store.remote.get(FakeSyncStore.key(table, key));
    });

    channel.attachPeer('client-a', heldByPeer([one.changeSet]));
    await until(() => agent.snapshot().catchUp.lastStartedAt !== null);
    channel.attachPeer('client-b', heldByPeer([one.changeSet, two.changeSet]));
    await until(() => agent.snapshot().catchUp.missingAtStart === 2);
    expect(agent.snapshot().catchUp.lastCompletedAt).toBeNull();
    release();
    await until(() => agent.snapshot().catchUp.lastCompletedAt !== null);

    expect(agent.snapshot()).toMatchObject({
      received: 2,
      catchUp: { missingAtStart: 2, pulled: 2 },
    });
  });

  it('completes a catch-up whose missing change sets turn out to be held meanwhile', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const mine = store.writeOwnChangeSet('mine', []);
    store.heldChangeSets = () => Promise.resolve([]);

    channel.attachPeer('hub-node', heldByPeer([mine]));
    await until(() => agent.snapshot().catchUp.lastCompletedAt !== null);

    expect(agent.snapshot()).toMatchObject({
      skipped: 1,
      received: 0,
      catchUp: { missingAtStart: 1, pulled: 0 },
    });
    expect(store.pulls).toStrictEqual([]);
  });

  it('tries a peer whose list cannot be read again, and gives up after the configured attempts', async () => {
    const { channels, agent, records } = agentOverFakes({
      retryIntervalMs: 20,
      maxAttempts: 2,
    });
    const channel = new FakeChannel();
    channels.publish(channel);
    let reads = 0;

    channel.attachPeer('hub-node', () => {
      reads += 1;
      return Promise.reject(new Error('IoPeer: socket closed (dumpTable)'));
    });
    await until(() => reads === 2);
    await settle();

    expect(reads).toBe(2);
    expect(agent.snapshot().lastError).toBe(
      'catch-up with hub-node failed: pull of the change set list of hub-node failed: IoPeer: socket closed (dumpTable)',
    );
    expect(agent.snapshot().catchUp.lastStartedAt).toBeNull();
    expect(
      records.filter(
        (record) =>
          record.level === 'warn' &&
          record.message === 'catch-up could not read what the peer holds',
      ),
    ).toHaveLength(2);
  });

  it('reads the peer once its list works again', async () => {
    const { store, channels, agent } = agentOverFakes({
      retryIntervalMs: 20,
      maxAttempts: 5,
    });
    const mine = store.writeOwnChangeSet('mine', []);
    const channel = new FakeChannel();
    channels.publish(channel);
    let reads = 0;

    channel.attachPeer('hub-node', () => {
      reads += 1;
      return reads < 3
        ? Promise.reject(new Error('not yet'))
        : Promise.resolve([]);
    });
    await until(() => channel.sent.length === 1);

    expect(channel.sent).toStrictEqual([mine._hash]);
    expect(reads).toBe(3);
    expect(agent.snapshot().catchUp.lastCompletedAt).not.toBeNull();
  });

  it('forgets a failed catch-up when the channel goes away', async () => {
    const { channels } = agentOverFakes({ retryIntervalMs: 20 });
    const channel = new FakeChannel();
    channels.publish(channel);
    let reads = 0;

    channel.attachPeer('hub-node', () => {
      reads += 1;
      return Promise.reject(new Error('gone'));
    });
    await until(() => reads === 1);
    channels.publish(null);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(reads).toBe(1);
  });

  it('logs a comparison that fails on this side and leaves it to the next attach', async () => {
    const { store, channels, agent, records } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    store.heldChangeSets = () => Promise.reject(new Error('store is closed'));

    channel.attachPeer('hub-node', []);
    await until(() =>
      records.some(
        (record) =>
          record.message === 'catch-up could not compare the change sets',
      ),
    );

    expect(agent.snapshot().lastError).toBe(
      'catch-up with hub-node failed: store is closed',
    );
    expect(agent.snapshot().catchUp.lastStartedAt).toBeNull();
    expect(channel.sent).toStrictEqual([]);
  });

  it('gives up on a peer list that does not arrive within the pull timeout, and stops without waiting for it', async () => {
    const { store, channels, agent, records } = agentOverFakes({
      pullTimeoutMs: 40,
      retryIntervalMs: 60_000,
    });
    store.writeOwnChangeSet('mine', []);
    const channel = new FakeChannel();
    channels.publish(channel);
    let release: (held: never[]) => void = () => undefined;
    channel.attachPeer(
      'hub-node',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await until(() =>
      records.some(
        (record) =>
          record.message === 'catch-up could not read what the peer holds',
      ),
    );
    expect(agent.snapshot().lastError).toBe(
      'catch-up with hub-node failed: pull of the change set list of hub-node exceeded 40 ms',
    );

    const started = Date.now();
    await agent.stop();
    expect(Date.now() - started).toBeLessThan(1_000);
    release([]);
    await settle();

    expect(channel.sent).toStrictEqual([]);
    expect(agent.snapshot().catchUp.lastStartedAt).toBeNull();
  });
});

describe('SyncAgent receiving', () => {
  it('pulls the change set and every item, verifies them, writes them and records the change set', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, animal, history } = remoteAnimalVersion(store, 'Bowser');

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().received === 1);

    expect(store.local.get(`animals@${animal._hash}`)).toStrictEqual(animal);
    expect(store.local.get(`animalsInsertHistory@${history._hash}`)).toBe(
      history,
    );
    expect(store.recorded).toStrictEqual([changeSet]);
    expect(store.pulls).toStrictEqual([
      `changeSets@${changeSet._hash}`,
      `animals@${animal._hash}`,
      `animalsInsertHistory@${history._hash}`,
    ]);
    expect(agent.snapshot()).toMatchObject({
      received: 1,
      pending: 0,
      failed: 0,
      skipped: 0,
      lastError: null,
    });
    expect(agent.snapshot().transfers[0]).toMatchObject({
      direction: 'incoming',
      peerNodeId: 'node2',
      changeSetHash: changeSet._hash,
      changeSetId: changeSet.id,
      tables: { animals: 1, animalsInsertHistory: 1 },
      status: 'completed',
    });
    expect(agent.snapshot().transfers[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(store.writes).toStrictEqual([
      [`animals@${animal._hash}`, `animalsInsertHistory@${history._hash}`],
    ]);
  });

  it('pulls the data rows of a change set before its history rows and writes them all at once', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const invoice = hashed({ id: 'invoice-1', customerRef: 'c' });
    const invoiceHistory = hashed({
      invoicesRef: invoice._hash,
      timeId: '1:aaaa',
    });
    const item = hashed({ id: 'invoice-1-item-1', invoiceRef: invoice._hash });
    const itemHistory = hashed({
      invoiceItemsRef: item._hash,
      timeId: '2:aaaa',
    });
    const changeSet = hashed({
      id: 'issue-invoice-1',
      items: [
        { table: 'invoices', ref: invoice._hash },
        { table: 'invoicesInsertHistory', ref: invoiceHistory._hash },
        { table: 'invoiceItems', ref: item._hash },
        { table: 'invoiceItemsInsertHistory', ref: itemHistory._hash },
      ],
    });
    store.serve('invoices', invoice);
    store.serve('invoicesInsertHistory', invoiceHistory);
    store.serve('invoiceItems', item);
    store.serve('invoiceItemsInsertHistory', itemHistory);
    store.serve('changeSets', changeSet);
    store.local.set('customers@c', { _hash: 'c' });
    const localBeforeEachPull: number[] = [];
    store.onPull((table, key) => {
      localBeforeEachPull.push(store.local.size);
      return store.remote.get(FakeSyncStore.key(table, key));
    });

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().received === 1);

    expect(store.pulls).toStrictEqual([
      `changeSets@${changeSet._hash}`,
      `invoices@${invoice._hash}`,
      `invoiceItems@${item._hash}`,
      `invoicesInsertHistory@${invoiceHistory._hash}`,
      `invoiceItemsInsertHistory@${itemHistory._hash}`,
    ]);
    // Nothing landed while the rows were pulled: one write for all four.
    expect(new Set(localBeforeEachPull).size).toBe(1);
    expect(store.writes).toStrictEqual([
      [
        `invoices@${invoice._hash}`,
        `invoiceItems@${item._hash}`,
        `invoicesInsertHistory@${invoiceHistory._hash}`,
        `invoiceItemsInsertHistory@${itemHistory._hash}`,
      ],
    ]);
  });

  it('writes nothing of a change set whose pull breaks off', async () => {
    const { store, channels, agent } = agentOverFakes({
      pullTimeoutMs: 40,
      retryIntervalMs: 60_000,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, history } = remoteAnimalVersion(store, 'Bowser');
    store.remote.delete(`animalsInsertHistory@${history._hash}`);

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().transfers.length === 1);

    expect(agent.snapshot()).toMatchObject({ pending: 1, received: 0 });
    expect(store.writes).toStrictEqual([]);
    expect(
      [...store.local.keys()].some((key) => key.startsWith('animals@')),
    ).toBe(false);
  });

  it('skips a change set the store already holds and counts it', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const own = store.writeOwnChangeSet('mine', []);

    channel.deliver({ changeSetHash: own._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().skipped === 1);

    expect(store.pulls).toStrictEqual([]);
    expect(store.recorded).toStrictEqual([]);
    expect(agent.snapshot().transfers).toHaveLength(1);
  });

  it('writes a change set once when it is announced twice, even at the same time', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet } = remoteAnimalVersion(store, 'Bowser');

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().received === 1);
    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node3' });
    await until(() => agent.snapshot().skipped === 1);

    expect(store.recorded).toHaveLength(1);
    expect(
      store.pulls.filter((pull) => pull === `changeSets@${changeSet._hash}`),
    ).toHaveLength(1);
  });

  it('keeps the order of arrival and pulls several change sets at a time', async () => {
    const { store, channels, agent } = agentOverFakes({ concurrency: 2 });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const versions = ['One', 'Two', 'Three', 'Four'].map((name, index) =>
      remoteAnimalVersion(store, name, { timeId: `${1000 + index}:abcd` }),
    );
    let inFlight = 0;
    let mostInFlight = 0;
    store.onPull(async (table, key) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return store.remote.get(FakeSyncStore.key(table, key));
    });

    for (const version of versions) {
      channel.deliver({
        changeSetHash: version.changeSet._hash,
        fromNodeId: 'node2',
      });
    }
    await until(() => agent.snapshot().received === 4);

    expect(mostInFlight).toBe(2);
    expect(store.recorded.map((changeSet) => changeSet.id)).toStrictEqual(
      versions.map((version) => version.changeSet.id),
    );
  });

  it('fails a change set whose row does not hash to its content and skips the row', async () => {
    const { store, channels, agent, records } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, animal } = remoteAnimalVersion(store, 'Bowser');
    store.serve('animals', { ...animal, name: 'Tampered' });

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(store.local.has(`animals@${animal._hash}`)).toBe(false);
    expect(store.recorded).toStrictEqual([]);
    expect(agent.snapshot()).toMatchObject({
      received: 0,
      pending: 0,
      failed: 1,
      lastError: `row animals@${animal._hash} does not hash to its content, skipped`,
    });
    expect(agent.snapshot().transfers[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('does not hash to its content') as string,
    });
    expect(records).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'change set failed' }),
    );
    await settle();
    expect(agent.snapshot().failed).toBe(1);
  });

  it('fails a change set that comes back under another hash', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const other = hashed({ id: 'other', items: [] });
    store.onPull(async () => other);

    channel.deliver({ changeSetHash: 'AnnouncedHash', fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(agent.snapshot().lastError).toBe(
      `row changeSets@AnnouncedHash came back as ${other._hash}, skipped`,
    );
  });

  it('fails a change set the read cascade rejected for its hash', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    store.onPull(async () => {
      throw new Error(
        'Hash "abc" does not match the newly calculated one "def". Please make sure that all systems are producing the same hashes.',
      );
    });

    channel.deliver({ changeSetHash: 'AnnouncedHash', fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(store.pulls).toHaveLength(1);
  });

  it('fails a change set row without a list of items', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const broken = hashed({ id: 'broken', items: 'nothing' });
    store.serve('changeSets', broken);

    channel.deliver({ changeSetHash: broken._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(agent.snapshot().lastError).toContain(
      'is not a change set with a list of items',
    );
  });

  it('keeps a change set pending while a peer does not answer and retries until it does', async () => {
    const { store, channels, agent, records } = agentOverFakes({
      pullTimeoutMs: 40,
      retryIntervalMs: 30,
      maxAttempts: 10,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet } = remoteAnimalVersion(store, 'Bowser');
    let hanging = true;
    store.onPull((table, key) =>
      hanging
        ? new Promise(() => undefined)
        : store.remote.get(FakeSyncStore.key(table, key)),
    );

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().transfers.length >= 2);

    expect(agent.snapshot()).toMatchObject({
      pending: 1,
      received: 0,
      failed: 0,
      lastError: `pull of changeSets@${changeSet._hash} exceeded 40 ms`,
    });
    expect(agent.snapshot().transfers[0]).toMatchObject({
      status: 'pending',
      error: expect.stringContaining('exceeded 40 ms') as string,
    });
    const pendingRecords = () =>
      records.filter(
        (record) =>
          record.message === 'change set pending, will be pulled again',
      );
    await until(() => pendingRecords().length >= 2);
    expect(
      pendingRecords()
        .map((record) => record.level)
        .slice(0, 2),
    ).toStrictEqual(['warn', 'debug']);
    const roundAfterFailure = () =>
      records.find(
        (record) =>
          record.message === 'pending change sets are pulled again' &&
          record.fields.lastError !== null,
      );
    await until(() => roundAfterFailure() !== undefined);
    const round = roundAfterFailure()!;
    expect(round.level).toBe('info');
    expect(round.fields).toMatchObject({
      pending: 1,
      lastError: expect.stringContaining('exceeded 40 ms') as string,
    });
    expect(round.fields.attemptsMax).toBeGreaterThanOrEqual(1);
    expect(round.fields.oldestSinceMs).toBeGreaterThanOrEqual(0);

    hanging = false;
    await until(() => agent.snapshot().received === 1);
    expect(agent.snapshot().pending).toBe(0);
    expect(store.recorded).toHaveLength(1);
    expect(
      pendingRecords().filter((record) => record.level === 'warn'),
    ).toHaveLength(1);
  });

  it('reports the tables of a change set on a pending transfer once its row was read', async () => {
    const { store, channels, agent } = agentOverFakes({
      pullTimeoutMs: 40,
      retryIntervalMs: 60_000,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, animal } = remoteAnimalVersion(store, 'Bowser');
    store.remote.delete(`animals@${animal._hash}`);

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().transfers.length === 1);

    expect(agent.snapshot().transfers[0]).toMatchObject({
      status: 'pending',
      changeSetId: changeSet.id,
      tables: { animals: 1, animalsInsertHistory: 1 },
    });
  });

  it('fails a change set naming more items than allowed without pulling any', async () => {
    const { store, channels, agent } = agentOverFakes({
      maxChangeSetItems: 2,
    });
    const channel = new FakeChannel();
    channels.publish(channel);
    const oversized = hashed({
      id: 'oversized',
      items: [
        { table: 'animals', ref: 'a' },
        { table: 'animals', ref: 'b' },
        { table: 'animals', ref: 'c' },
      ],
    });
    store.serve('changeSets', oversized);

    channel.deliver({ changeSetHash: oversized._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(store.pulls).toStrictEqual([`changeSets@${oversized._hash}`]);
    expect(agent.snapshot().lastError).toBe(
      `row changeSets@${oversized._hash} names 3 items, more than the 2 allowed, skipped`,
    );
  });

  it('fails a change set naming a table this store does not have without pulling any', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const strange = hashed({
      id: 'strange',
      items: [
        { table: 'animals', ref: 'a' },
        { table: 'unicorns', ref: 'u' },
      ],
    });
    store.serve('changeSets', strange);

    channel.deliver({ changeSetHash: strange._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(store.pulls).toStrictEqual([`changeSets@${strange._hash}`]);
    expect(agent.snapshot().lastError).toBe(
      `row changeSets@${strange._hash} names a table this store does not have: "unicorns", skipped`,
    );
    await settle();
    expect(agent.snapshot()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('retries a pending change set at once when it is announced again', async () => {
    const { store, channels, agent } = agentOverFakes({
      pullTimeoutMs: 40,
      retryIntervalMs: 60_000,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet } = remoteAnimalVersion(store, 'Bowser');
    let answers = false;
    store.onPull(async (table, key) => {
      if (!answers) {
        throw new Error('Io "io-1" is closed');
      }
      return store.remote.get(FakeSyncStore.key(table, key));
    });

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().transfers.length === 1);
    expect(agent.snapshot().lastError).toBe(
      `pull of changeSets@${changeSet._hash} failed: Io "io-1" is closed`,
    );

    answers = true;
    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().received === 1);

    expect(agent.snapshot().pending).toBe(0);
  });

  it('gives a pending change set up after the configured attempts', async () => {
    const { store, channels, agent } = agentOverFakes({
      pullTimeoutMs: 20,
      retryIntervalMs: 10,
      maxAttempts: 3,
    });
    const channel = new FakeChannel();
    channels.publish(channel);
    store.onPull(async () => undefined);

    channel.deliver({ changeSetHash: 'NobodyHasThis', fromNodeId: 'node2' });
    await until(() => agent.snapshot().failed === 1);

    expect(store.pulls).toHaveLength(3);
    expect(agent.snapshot()).toMatchObject({ pending: 0, received: 0 });
    expect(agent.snapshot().lastError).toBe(
      'row changeSets@NobodyHasThis is not held by any node',
    );
    await settle();
    expect(store.pulls).toHaveLength(3);
  });

  it('leaves the pending change set of a row nobody has and completes it once a node has it', async () => {
    const { store, channels, agent } = agentOverFakes({
      retryIntervalMs: 20,
      maxAttempts: 10,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, animal } = remoteAnimalVersion(store, 'Bowser');
    store.remote.delete(`animals@${animal._hash}`);

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().transfers.length >= 1);
    expect(agent.snapshot()).toMatchObject({ pending: 1, received: 0 });
    expect(store.recorded).toStrictEqual([]);

    store.serve('animals', animal);
    await until(() => agent.snapshot().received === 1);

    expect(store.recorded).toStrictEqual([changeSet]);
  });

  it('ignores announcements after stop and settles the pulls in flight', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet } = remoteAnimalVersion(store, 'Bowser');
    store.onPull(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(store.remote.get(`changeSets@x`)), 20),
        ),
    );
    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });

    await agent.stop();
    channel.deliver({ changeSetHash: 'after-stop', fromNodeId: 'node2' });
    await settle();

    expect(store.pulls).toHaveLength(1);
    expect(agent.snapshot().pending).toBeLessThanOrEqual(1);
  });

  it('tells its transfer listeners when a pull starts and when it settles, and about announcements', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel('hub-node');
    channels.publish(channel);
    const { changeSet } = remoteAnimalVersion(store, 'Bowser');
    const heard: string[] = [];
    const unsubscribe = agent.onTransfer((transfer) =>
      heard.push(
        `${transfer.direction} ${transfer.status} ${transfer.changeSetId ?? '?'} ${transfer.error ?? ''}`.trim(),
      ),
    );

    const own = store.writeOwnChangeSet('mine', []);
    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().received === 1);
    channel.deliver({ changeSetHash: own._hash, fromNodeId: 'node2' });
    await until(() => agent.snapshot().skipped === 1);

    expect(heard).toStrictEqual([
      'outgoing completed mine',
      'incoming pending ?',
      `incoming completed ${changeSet.id}`,
    ]);
    expect(
      agent.snapshot().transfers.map((transfer) => transfer.status),
    ).toStrictEqual(['completed', 'completed']);

    unsubscribe();
    store.writeOwnChangeSet('later', []);
    expect(heard).toHaveLength(3);
  });
});

describe('SyncAgent pulling what received rows point at', () => {
  it('pulls the referenced rows and the previous versions this node lacks, recursively', async () => {
    const { store, channels, agent } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    // Version one chains from the seed version this node holds; version
    // two chains from version one, which this node has not received.
    const seedHistory = hashed({
      animalsRef: 'seed-animal-hash',
      timeId: seedTimeId(5),
      route: '/animals',
      origin: 'seed',
      previous: [],
    });
    store.local.set(`animalsInsertHistory@${seedHistory._hash}`, seedHistory);
    const newSpecies = hashed({ id: 'wolf', name: 'Wolf' });
    store.serve('species', newSpecies);
    const one = remoteAnimalVersion(store, 'Bowser One', {
      timeId: '1700000000000:one1',
      previous: [seedTimeId(5)],
      speciesRef: newSpecies._hash,
    });
    const two = remoteAnimalVersion(store, 'Bowser Two', {
      timeId: '1700000000001:two2',
      previous: ['1700000000000:one1'],
      speciesRef: newSpecies._hash,
    });

    channel.deliver({ changeSetHash: two.changeSet._hash, fromNodeId: 'n2' });
    await until(() => agent.snapshot().received === 1);

    expect(store.local.get(`species@${newSpecies._hash}`)).toBe(newSpecies);
    expect(store.local.get(`animalsInsertHistory@${one.history._hash}`)).toBe(
      one.history,
    );
    expect(store.local.get(`animals@${one.animal._hash}`)).toBe(one.animal);
    expect(store.pulls).toContain(
      'animalsInsertHistory@timeId:1700000000000:one1',
    );
    expect(store.pulls).not.toContain(
      `animalsInsertHistory@timeId:${seedTimeId(5)}`,
    );
    expect(store.recorded).toStrictEqual([two.changeSet]);
    expect(agent.snapshot().transfers[0]!.tables).toStrictEqual({
      animals: 1,
      animalsInsertHistory: 1,
    });
  });

  it('stops at the dependency bound and still completes the change set', async () => {
    const { store, channels, agent, records } = agentOverFakes({
      dependencyBound: 2,
    });
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    let previous: string[] = [];
    const chain = [0, 1, 2, 3, 4].map((index) => {
      const version = remoteAnimalVersion(store, `Bowser ${index}`, {
        timeId: `${1700000000000 + index}:c${index}00`,
        previous,
      });
      previous = [`${1700000000000 + index}:c${index}00`];
      return version;
    });

    channel.deliver({
      changeSetHash: chain[4]!.changeSet._hash,
      fromNodeId: 'n2',
    });
    await until(() => agent.snapshot().received === 1);

    // Two dependency pulls: the history row of version three and its
    // animal row; version two and everything before it stay out.
    const pulledHistory = chain.filter((version) =>
      store.local.has(`animalsInsertHistory@${version.history._hash}`),
    );
    expect(pulledHistory.map((version) => version.animal.name)).toStrictEqual([
      'Bowser 3',
      'Bowser 4',
    ]);
    expect(store.local.has(`animals@${chain[3]!.animal._hash}`)).toBe(true);
    expect(store.local.has(`animals@${chain[2]!.animal._hash}`)).toBe(false);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message:
          'dependency bound reached, remaining references are left to their own change sets',
      }),
    );
  });

  it('completes the change set when a dependency cannot be pulled, and logs it', async () => {
    const { store, channels, agent, records } = agentOverFakes();
    holdReferencedRows(store);
    const channel = new FakeChannel();
    channels.publish(channel);
    const { changeSet, animal } = remoteAnimalVersion(store, 'Bowser', {
      speciesRef: 'species-nobody-has',
    });
    store.serve('animals', { ...animal, _hash: animal._hash });

    channel.deliver({ changeSetHash: changeSet._hash, fromNodeId: 'n2' });
    await until(() => agent.snapshot().received === 1);

    expect(store.local.has('species@species-nobody-has')).toBe(false);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'a row the received rows point at could not be pulled',
      }),
    );
  });
});
