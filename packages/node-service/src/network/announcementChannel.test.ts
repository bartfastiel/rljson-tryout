import { Connector, Db } from '@rljson/db';
import { createSocketPair, IoMem } from '@rljson/io';
import { Route, syncEvents, type ConnectorPayload } from '@rljson/rljson';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AnnouncementOrigins,
  ConnectorChannel,
  type Announcement,
} from './announcementChannel.ts';

const route = Route.fromFlat('changeSets');
const events = syncEvents(route.flat);

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * A connector over one end of a socket pair, the origins registered on
 * the same end first, the way the hub transport builds both; the other
 * end plays the hub (or, for the hub's own channel, the `Server`).
 */
const channelOverPair = async (peerNodeId: string | null) => {
  const [near, far] = createSocketPair();
  near.connect();
  const io = new IoMem();
  await io.init();
  cleanups.push(() => io.close());
  const origins = new AnnouncementOrigins(near, events);
  const connector = new Connector(
    new Db(io),
    route,
    near,
    { includeClientIdentity: true },
    'this-node',
  );
  cleanups.push(() => connector.tearDown());
  const received: ConnectorPayload[] = [];
  far.on(events.ref, (payload: ConnectorPayload) => received.push(payload));
  return {
    channel: new ConnectorChannel(connector, origins, peerNodeId),
    far,
    received,
  };
};

describe('ConnectorChannel', () => {
  it('sends the hash with the node id as client identity and allows the same hash again', async () => {
    const { channel, received } = await channelOverPair('hub-node');

    channel.send('HashOne');
    channel.send('HashOne');

    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ r: 'HashOne', c: 'this-node' });
    expect(typeof received[0]!.o).toBe('string');
    expect(typeof received[0]!.t).toBe('number');
    expect(channel.peerNodeId).toBe('hub-node');
  });

  it('delivers an announcement with the node id its payload carried', async () => {
    const { channel, far } = await channelOverPair('hub-node');
    const announcements: Announcement[] = [];
    channel.listen((announcement) => announcements.push(announcement));

    far.emit(events.ref, { o: 'other-origin', r: 'HashOne', c: 'node2' });
    far.emit(events.ref, { o: 'other-origin', r: 'HashTwo' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(announcements).toStrictEqual([
      { changeSetHash: 'HashOne', fromNodeId: 'node2' },
      { changeSetHash: 'HashTwo', fromNodeId: null },
    ]);
  });

  it('delivers a bootstrap announcement without an origin', async () => {
    const { channel, far } = await channelOverPair('hub-node');
    const announcements: Announcement[] = [];
    channel.listen((announcement) => announcements.push(announcement));

    far.emit(events.bootstrap, {
      o: 'other-origin',
      r: 'Latest',
      c: 'client_announce_id',
      seq: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(announcements).toStrictEqual([
      { changeSetHash: 'Latest', fromNodeId: null },
    ]);
  });

  it('lets the connector drop a repeated announcement and its own echo', async () => {
    const { channel, far, received } = await channelOverPair(null);
    const announcements: Announcement[] = [];
    channel.listen((announcement) => announcements.push(announcement));

    far.emit(events.ref, { o: 'other-origin', r: 'HashOne', c: 'node2' });
    far.emit(events.ref, { o: 'other-origin', r: 'HashOne', c: 'node2' });
    channel.send('Mine');
    const ownOrigin = received[0]!.o;
    far.emit(events.ref, { o: ownOrigin, r: 'Mine', c: 'this-node' });
    far.emit(events.ref, { o: ownOrigin, r: 'Echo' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(announcements).toStrictEqual([
      { changeSetHash: 'HashOne', fromNodeId: 'node2' },
    ]);
  });

  it('tells its join listeners when a peer joined', async () => {
    const { channel } = await channelOverPair(null);
    let joins = 0;
    channel.onPeerJoined(() => {
      joins += 1;
    });

    channel.peerJoined();
    channel.peerJoined();

    expect(joins).toBe(2);
  });
});

describe('AnnouncementOrigins', () => {
  it('forgets the oldest hashes beyond its capacity', () => {
    const [near, far] = createSocketPair();
    const origins = new AnnouncementOrigins(near, events);

    for (let index = 0; index < 1_001; index += 1) {
      far.emit(events.ref, { o: 'x', r: `hash-${index}`, c: `node-${index}` });
    }

    expect(origins.originOf('hash-0')).toBeNull();
    expect(origins.originOf('hash-1')).toBe('node-1');
    expect(origins.originOf('hash-1000')).toBe('node-1000');
    expect(origins.originOf('never-announced')).toBeNull();
  });
});
