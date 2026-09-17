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
    replayDelaysMs: [10],
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

describe('SyncAgent announcing', () => {
  it('queues change sets written without a channel and announces them in order once one appears', () => {
    const { store, channels, agent } = agentOverFakes();
    const first = store.writeOwnChangeSet('first', []);
    const second = store.writeOwnChangeSet('second', [
      { table: 'animals', ref: 'a' },
      { table: 'animalsInsertHistory', ref: 'b' },
    ]);
    expect(agent.snapshot().announced).toBe(0);

    const channel = new FakeChannel('hub-node');
    channels.publish(channel);

    expect(channel.sent).toStrictEqual([first._hash, second._hash]);
    expect(agent.snapshot()).toMatchObject({ announced: 2, pending: 0 });
    expect(agent.snapshot().transfers).toStrictEqual([
      expect.objectContaining({
        direction: 'outgoing',
        peerNodeId: 'hub-node',
        changeSetHash: second._hash,
        changeSetId: 'second',
        tables: { animals: 1, animalsInsertHistory: 1 },
        status: 'completed',
      }),
      expect.objectContaining({
        changeSetHash: first._hash,
        changeSetId: 'first',
        tables: {},
      }),
    ]);
  });

  it('announces a change set written while the channel is up right away', () => {
    const { store, channels } = agentOverFakes();
    const channel = new FakeChannel();
    channels.publish(channel);

    const changeSet = store.writeOwnChangeSet('live', []);

    expect(channel.sent).toStrictEqual([changeSet._hash]);
  });

  it('queues again while the node has no channel and announces on the next one', () => {
    const { store, channels } = agentOverFakes();
    const first = new FakeChannel();
    channels.publish(first);
    store.writeOwnChangeSet('while-connected', []);
    channels.publish(null);
    const offline = store.writeOwnChangeSet('while-offline', []);

    const second = new FakeChannel();
    channels.publish(second);

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toStrictEqual([offline._hash]);
  });

  it('repeats the announcements of the current channel when a peer joins, without counting them again', async () => {
    const { store, channels, agent } = agentOverFakes();
    const channel = new FakeChannel(null);
    channels.publish(channel);
    const changeSet = store.writeOwnChangeSet('seeded', []);

    channel.peerJoined();
    await until(() => channel.sent.length === 2);

    expect(channel.sent).toStrictEqual([changeSet._hash, changeSet._hash]);
    expect(agent.snapshot().announced).toBe(1);
    expect(agent.snapshot().transfers).toHaveLength(1);
  });

  it('does not repeat announcements of an earlier channel', async () => {
    const { store, channels } = agentOverFakes();
    const first = new FakeChannel(null);
    channels.publish(first);
    store.writeOwnChangeSet('on-first', []);
    const second = new FakeChannel(null);
    channels.publish(second);

    second.peerJoined();
    await settle();

    expect(second.sent).toStrictEqual([]);
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
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'change set pending, will be pulled again',
      }),
    );

    hanging = false;
    await until(() => agent.snapshot().received === 1);
    expect(agent.snapshot().pending).toBe(0);
    expect(store.recorded).toHaveLength(1);
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
