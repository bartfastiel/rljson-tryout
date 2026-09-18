import type { Connector } from '@rljson/db';
import type { Socket } from '@rljson/io';
import type { ConnectorPayload, SyncEventNames } from '@rljson/rljson';

import type { HeldChangeSet } from '../store/petShopStore.ts';

/**
 * One change set hash as it arrived on the `changeSets` route, with the
 * client identity the announcing connector attached to its payload
 * (`ConnectorPayload.c`): this project sets it to the node id of the
 * node that wrote the change set, so a receiver knows who wrote what it
 * pulls, even through the hub's relay, which forwards the payload as it
 * came. `null` when the payload carried none: the hub's bootstrap of its
 * latest reference names the hub's own announce id instead, and a
 * connector without `includeClientIdentity` names nothing.
 */
export type Announcement = Readonly<{
  changeSetHash: string;
  fromNodeId: string | null;
}>;

export type AnnouncementListener = (announcement: Announcement) => void;

/**
 * A node whose store this node can list change sets from without the read
 * cascade, the moment the two are connected: the hub on a client, each
 * client on the hub. `nodeId` is that node's id as it introduced itself
 * (`null` when it did not), `heldChangeSets` reads the change sets it
 * holds from its store alone, so the catch-up of slice D4 can compare
 * them with what this node holds.
 */
export type AttachedPeer = Readonly<{
  nodeId: string | null;
  heldChangeSets(): Promise<readonly HeldChangeSet[]>;
}>;

export type PeerListener = (peer: AttachedPeer) => void;

/**
 * Where a node announces its change sets and hears the announcements of
 * the others while it has a role in the network: on a client the
 * `Connector` of its `Client` (a `send` goes to the hub, which relays it
 * to every other client and to its own agent), on the hub a `Connector`
 * over a loopback socket pair registered with the `Server` as a
 * broadcast-only client (a `send` reaches every client, every client's
 * announcement reaches it). `peerNodeId` is the node a `send` goes to:
 * the hub's id on a client, `null` on the hub, whose announcements go to
 * every connected client. `onPeerAttached` fires with every node whose
 * store becomes readable through this channel: on a client the hub, once
 * connected and again after every reconnection; on the hub every client
 * that was added. The agent catches up with each of them.
 */
export type AnnouncementChannel = {
  readonly peerNodeId: string | null;
  send(changeSetHash: string): void;
  listen(listener: AnnouncementListener): void;
  onPeerAttached(listener: PeerListener): void;
};

/**
 * Remembers, per announced hash, the client identity its payload carried.
 * `Connector.listen` hands its callbacks the reference alone, not the
 * payload, so the origin has to be read off the socket before the
 * connector consumes the event: an instance is created on the socket
 * before the `Connector` is, and since both socket.io and the
 * `DirectionalSocketMock` call listeners in registration order, this one
 * has recorded the origin by the time the connector's callback runs.
 * Bounded to the last thousand hashes; an origin that fell out reads as
 * unknown.
 */
export class AnnouncementOrigins {
  private static readonly capacity = 1_000;
  private readonly origins = new Map<string, string | null>();

  constructor(socket: Socket, events: SyncEventNames) {
    socket.on(events.ref, (payload: ConnectorPayload) => {
      this.remember(payload.r, payload.c ?? null);
    });
  }

  originOf(changeSetHash: string): string | null {
    return this.origins.get(changeSetHash) ?? null;
  }

  private remember(changeSetHash: string, origin: string | null): void {
    this.origins.delete(changeSetHash);
    this.origins.set(changeSetHash, origin);
    if (this.origins.size > AnnouncementOrigins.capacity) {
      const oldest = this.origins.keys().next().value;
      if (oldest !== undefined) {
        this.origins.delete(oldest);
      }
    }
  }
}

/**
 * An `AnnouncementChannel` over a `Connector` of `@rljson/db`. A `send`
 * first forgets that the connector already sent the hash: the connector
 * drops a reference it has sent or received before, which is right for a
 * state that is never announced twice and wrong here, where the agent
 * announces a change set again to a peer that lacks it and decides about
 * duplicates itself, by looking at what the store holds.
 */
export class ConnectorChannel implements AnnouncementChannel {
  readonly peerNodeId: string | null;
  private readonly connector: Connector;
  private readonly origins: AnnouncementOrigins;
  private readonly peerListeners: PeerListener[] = [];

  constructor(
    connector: Connector,
    origins: AnnouncementOrigins,
    peerNodeId: string | null,
  ) {
    this.connector = connector;
    this.origins = origins;
    this.peerNodeId = peerNodeId;
  }

  send(changeSetHash: string): void {
    this.connector.invalidateSent(changeSetHash);
    this.connector.send(changeSetHash);
  }

  listen(listener: AnnouncementListener): void {
    this.connector.listen((changeSetHash: string) => {
      listener({
        changeSetHash,
        fromNodeId: this.origins.originOf(changeSetHash),
      });
      return Promise.resolve();
    });
  }

  onPeerAttached(listener: PeerListener): void {
    this.peerListeners.push(listener);
  }

  /**
   * Called by the hub transport with the hub once a client is connected
   * to it, and on the hub with every client socket that was added.
   */
  peerAttached(peer: AttachedPeer): void {
    for (const listener of this.peerListeners) {
      listener(peer);
    }
  }
}
