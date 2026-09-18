import { createServer, type Server as HttpServer } from 'node:http';

import type { Bs } from '@rljson/bs';
import { Connector, Db } from '@rljson/db';
import { createSocketPair } from '@rljson/io';
import { Route, syncEvents, type SyncConfig } from '@rljson/rljson';
import {
  Client,
  Server,
  SocketIoBridge,
  type ServerLogger,
} from '@rljson/server';
import type { FastifyBaseLogger } from 'fastify';
import {
  Server as SocketIoServer,
  type Socket as HubSideSocket,
} from 'socket.io';
import {
  io as connectToHub,
  type Socket as ClientSocket,
} from 'socket.io-client';

import type { Configuration } from '../configuration.ts';
import { BorrowedIo } from '../store/borrowedIo.ts';
import {
  domainTableCfgs,
  heldChangeSetsOf,
  type PetShopStore,
} from '../store/petShopStore.ts';
import {
  AnnouncementOrigins,
  ConnectorChannel,
  type AnnouncementChannel,
  type AttachedPeer,
} from './announcementChannel.ts';

/**
 * The one route every node relays (roadmap section 3.4): a hub of
 * `@rljson/server` multicasts references of exactly one route, and this
 * project announces change set hashes on it (slice D3).
 */
export const changeSetsRoute = Route.fromFlat('changeSets');

const changeSetsEvents = syncEvents(changeSetsRoute.flat);

/**
 * The sync protocol flags this node's connectors run with: the payload of
 * every announcement carries the stable client identity, which this
 * project sets to the node id, so that a receiver knows which node wrote
 * the change set it pulls (`docs/findings/change-set-sync.md`). Causal
 * ordering and acknowledgements stay off until slices D9 and D10.
 */
const syncConfig: SyncConfig = { includeClientIdentity: true };

/**
 * What a role transition knows about the nodes involved, from discovery:
 * this node's own id (the identity its announcements carry) and the id of
 * the hub (the peer a client's announcements go to). Either is `null`
 * when unknown, which only the tests do; the connector then announces
 * under a generated identity.
 */
export type RoleContext = Readonly<{
  selfNodeId: string | null;
  hubNodeId: string | null;
}>;

const unknownContext: RoleContext = { selfNodeId: null, hubNodeId: null };

/**
 * Called with the announcement channel of the role this node just took,
 * and with `null` when it gave the role up.
 */
export type ChannelListener = (channel: AnnouncementChannel | null) => void;

/**
 * What `/status` reports under `transport`: nothing while the node runs
 * on its own; as hub the number of clients the `Server` currently holds;
 * as client whether the socket to the hub is connected and the `Client`
 * over it is initialized. `lastError` is the last failure of the transport
 * (a hub port that would not bind, a hub that cannot be reached, a socket
 * that dropped) and stays until the next successful step.
 */
export type TransportSnapshot =
  | { role: 'standalone'; hubAddress: null; lastError: string | null }
  | {
      role: 'hub';
      hubAddress: string | null;
      connectedClients: number;
      lastError: string | null;
    }
  | {
      role: 'client';
      hubAddress: string;
      connectedToHub: boolean;
      lastError: string | null;
    };

/**
 * What the transport needs from the node's store: the `Io` to lend to
 * `@rljson/server`, the switch that routes the store's reads through the
 * active multi, and the peer stores the synchronisation pulls from.
 */
export type TransportStore = Pick<
  PetShopStore,
  'localIo' | 'readThrough' | 'pullThrough'
>;

/**
 * The part of `HubTransport` the orchestrator drives, so that its unit
 * tests can record the transitions with a fake.
 */
export type Transport = Pick<
  HubTransport,
  'becomeHub' | 'becomeClient' | 'becomeStandalone' | 'stop' | 'snapshot'
>;

export type HubTransportOptions = Readonly<{
  /** How long `becomeClient` waits for the first connection to the hub. */
  connectTimeoutMs?: number;
  /** How often a busy hub port is retried, and how long between tries. */
  bindAttempts?: number;
  bindRetryDelayMs?: number;
  /**
   * How long the hub waits for a client it added to answer the ready
   * handshake; the same bound `@rljson/server` puts on a peer's
   * initialization.
   */
  peerInitTimeoutMs?: number;
}>;

type HubState = {
  role: 'hub';
  hubAddress: string | null;
  context: RoleContext;
  httpServer: HttpServer;
  socketServer: SocketIoServer;
  server: Server;
  connector: Connector;
  channel: ConnectorChannel;
};

type ClientState = {
  role: 'client';
  hubAddress: string;
  context: RoleContext;
  socket: ClientSocket;
  bridge: SocketIoBridge;
  origins: AnnouncementOrigins;
  client: Client | null;
  channel: ConnectorChannel | null;
  /** The hub's ready handshake, answered once the `Client` exists. */
  pendingReady: (() => void) | null;
  connected: boolean;
};

type TransportState = { role: 'standalone' } | HubState | ClientState;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The one event this project adds to the socket next to the library's:
 * the hub emits it to a client once `Server.addSocket` completed, with
 * the hub's node id, and the client acknowledges it, with its own node
 * id, once its `Client` is initialized. Only then do both sides list each
 * other's change sets: a peer request emitted before the other end
 * registered its handlers is lost, and `IoPeer` waits thirty seconds for
 * an answer that never comes, so neither side may ask before the other is
 * listening (`docs/findings/change-set-sync.md`).
 */
const readyEvent = 'petshop:ready';

type ReadyPayload = { nodeId: string | null };

const nodeIdIn = (payload: unknown): string | null => {
  const nodeId = (payload as Partial<ReadyPayload> | null)?.nodeId;
  return typeof nodeId === 'string' && nodeId.length > 0 ? nodeId : null;
};

/**
 * `@rljson/server` logs every socket, refresh and peer at `info`; that is
 * `debug` for this node, whose own log lines mark the transitions.
 */
const serverLoggerOver = (logger: FastifyBaseLogger): ServerLogger => ({
  info: (source, message, data) => logger.debug({ source, ...data }, message),
  warn: (source, message, data) => logger.warn({ source, ...data }, message),
  error: (source, message, error, data) =>
    logger.error({ source, err: error, ...data }, message),
  traffic: (direction, source, event, data) =>
    logger.trace({ source, direction, event, ...data }, 'socket traffic'),
});

/**
 * The hub transport of roadmap slice D2, driven by the `RoleOrchestrator`:
 * as hub, a socket.io server on `HUB_PORT` with a `Server` of
 * `@rljson/server` over the node's own `Io` and `Bs` behind it, every
 * connecting socket added through `SocketIoBridge`; as client, a socket.io
 * client connected to the hub's address with a `Client` over the same
 * local stores; standalone, neither. In both roles the store's row reads
 * are routed through the active `IoMulti` (`TransportStore.readThrough`),
 * so a read the local store cannot answer falls through to the hub and,
 * through the hub, to every other client, while writes stay local, and
 * the synchronisation pulls from the `IoPeer`s alone
 * (`TransportStore.pullThrough`), so that nothing lands in the store
 * before a whole change set does. Every
 * domain table is created on the `Server` or `Client` as
 * `docs/roadmap.md` section 3.2 asks, a no-op after the store created
 * them. The hub port is bound by the socket.io server itself, which also
 * answers the TCP probes of the other nodes (`docs/findings/network-discovery.md`).
 *
 * Each role also brings the node's announcement channel (slice D3): on
 * the hub a `Connector` over a loopback socket pair the `Server` holds as
 * a broadcast-only client, on a client the `Connector` of its `Client`;
 * `subscribe` hands the channel of the current role to the `SyncAgent`
 * and `null` when the node has none. Through the channel the agent also
 * learns about every peer whose store became readable (slice D4): the hub
 * once a client is connected and after every reconnection of its socket,
 * every client once the hub added it, each with the `IoPeer` the library
 * built towards it, so that the agent can compare change set lists
 * without the read cascade.
 *
 * Transitions are queued: a role flapping faster than a bind, a connect or
 * a teardown completes still ends in the state of the last call, and the
 * stores are never handed to two roles at once.
 */
export class HubTransport {
  private readonly hubPort: number;
  private readonly logger: FastifyBaseLogger;
  private readonly store: TransportStore;
  private readonly blobs: Bs;
  private readonly connectTimeoutMs: number;
  private readonly bindAttempts: number;
  private readonly bindRetryDelayMs: number;
  private readonly peerInitTimeoutMs: number;
  private state: TransportState = { role: 'standalone' };
  private lastError: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;
  private channel: AnnouncementChannel | null = null;
  private readonly channelListeners = new Set<ChannelListener>();

  constructor(
    configuration: Pick<Configuration, 'hubPort'>,
    logger: FastifyBaseLogger,
    store: TransportStore,
    blobs: Bs,
    options: HubTransportOptions = {},
  ) {
    this.hubPort = configuration.hubPort;
    this.logger = logger;
    this.store = store;
    this.blobs = blobs;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.bindAttempts = options.bindAttempts ?? 5;
    this.bindRetryDelayMs = options.bindRetryDelayMs ?? 200;
    this.peerInitTimeoutMs = options.peerInitTimeoutMs ?? 30_000;
  }

  /**
   * Starts serving the node's store on the hub port. `hubAddress` is the
   * address the other nodes use for this hub, as discovery reports it;
   * the socket.io server itself binds every interface. A node that is
   * already the hub keeps its server.
   */
  becomeHub(
    hubAddress: string | null,
    context: RoleContext = unknownContext,
  ): Promise<void> {
    return this.transition(async () => {
      if (this.state.role === 'hub') {
        this.state.hubAddress = hubAddress;
        return;
      }
      await this.tearDown();
      await this.startHub(hubAddress, context);
    });
  }

  /**
   * Connects to the hub at `hubAddress` (`ip:port`). Resolves once the
   * socket connected or `connectTimeoutMs` passed; in the latter case the
   * socket keeps trying in the background (socket.io reconnects on its
   * own), `/status` shows `connectedToHub: false` with the reason, and the
   * `Client` is attached the moment the first connection succeeds. A node
   * that is already a client of this address keeps its connection.
   */
  becomeClient(
    hubAddress: string,
    context: RoleContext = unknownContext,
  ): Promise<void> {
    return this.transition(async () => {
      if (
        this.state.role === 'client' &&
        this.state.hubAddress === hubAddress
      ) {
        return;
      }
      await this.tearDown();
      await this.startClient(hubAddress, context);
    });
  }

  /** Releases the hub port or the connection to the hub. */
  becomeStandalone(): Promise<void> {
    return this.transition(() => this.tearDown());
  }

  stop(): Promise<void> {
    return this.becomeStandalone();
  }

  /**
   * Subscribes to the announcement channel of the current role: the
   * listener is called right away with the current channel (`null` while
   * the node has none) and again on every change. Returns the function
   * that unsubscribes.
   */
  subscribe(listener: ChannelListener): () => void {
    this.channelListeners.add(listener);
    listener(this.channel);
    return () => {
      this.channelListeners.delete(listener);
    };
  }

  private publishChannel(channel: AnnouncementChannel | null): void {
    this.channel = channel;
    for (const listener of this.channelListeners) {
      listener(channel);
    }
  }

  snapshot(): TransportSnapshot {
    const state = this.state;
    if (state.role === 'hub') {
      return {
        role: 'hub',
        hubAddress: state.hubAddress,
        connectedClients: HubTransport.connectedClientsOf(state.server),
        lastError: this.lastError,
      };
    }
    if (state.role === 'client') {
      return {
        role: 'client',
        hubAddress: state.hubAddress,
        connectedToHub: state.connected && state.client !== null,
        lastError: this.lastError,
      };
    }
    return { role: 'standalone', hubAddress: null, lastError: this.lastError };
  }

  /**
   * The port the hub server is bound to, which differs from `HUB_PORT`
   * only when it is `0` (the tests bind an ephemeral port); `null` while
   * this node is not the hub.
   */
  boundPort(): number | null {
    return this.state.role === 'hub'
      ? this.boundPortOf(this.state.httpServer)
      : null;
  }

  /**
   * The clients connected over a socket: the `Server` counts its
   * broadcast-only loopback socket (the hub's own channel) among its
   * clients too, without an `IoPeer` behind it.
   */
  private static connectedClientsOf(server: Server): number {
    return [...server.clients.values()].filter((client) => client.io !== null)
      .length;
  }

  /**
   * A client the `Server` just added, as a peer the sync agent can list
   * change sets from: the `IoPeer` the server built over the client's
   * socket, which talks to the client's `IoPeerBridge` over the client's
   * own store, so a table dump through it is that client's table and
   * nothing else. Looked up by the socket the server registered, since
   * the server names its clients itself.
   */
  private static clientPeer(
    server: Server,
    bridge: SocketIoBridge,
    nodeId: string | null,
  ): AttachedPeer {
    const entry = [...server.clients.values()].find(
      (client) => client.ioUp === bridge,
    );
    return {
      nodeId,
      heldChangeSets: () => {
        if (entry === undefined) {
          return Promise.reject(
            new Error('the server does not list the socket of this client'),
          );
        }
        return heldChangeSetsOf(entry.io);
      },
    };
  }

  private boundPortOf(httpServer: HttpServer): number | null {
    const address = httpServer.address();
    return address === null || typeof address === 'string'
      ? null
      : address.port;
  }

  private transition(step: () => Promise<void>): Promise<void> {
    const next = this.queue.then(step).catch((error: unknown) => {
      this.lastError = errorMessage(error);
      this.logger.error({ err: error }, 'hub transport transition failed');
    });
    this.queue = next;
    return next;
  }

  private async startHub(
    hubAddress: string | null,
    context: RoleContext,
  ): Promise<void> {
    const server = new Server(
      changeSetsRoute,
      new BorrowedIo(this.store.localIo),
      this.blobs,
      { logger: serverLoggerOver(this.logger) },
    );
    await server.init();
    await server.createTables({ withInsertHistory: [...domainTableCfgs] });
    const { connector, channel } = await this.openHubChannel(server, context);

    const httpServer = createServer();
    const socketServer = new SocketIoServer(httpServer, {
      serveClient: false,
      transports: ['websocket'],
    });
    socketServer.on('connection', (socket) => {
      void this.addClient(server, socket);
    });
    try {
      await this.listen(httpServer);
    } catch (error) {
      await socketServer.close();
      connector.tearDown();
      await server.tearDown();
      throw error;
    }

    this.state = {
      role: 'hub',
      hubAddress,
      context,
      httpServer,
      socketServer,
      server,
      connector,
      channel,
    };
    this.lastError = null;
    this.store.readThrough(() => server.io);
    this.store.pullThrough(() =>
      [...server.clients.values()]
        .filter((client) => client.io !== null)
        .map((client) => client.io),
    );
    this.logger.info(
      { port: this.boundPort(), hubAddress },
      'hub transport serving',
    );
    this.publishChannel(channel);
  }

  /**
   * The hub's own announcement channel. A `Server` of `@rljson/server`
   * has no connector: it relays what its clients announce. So the hub
   * takes part as one more client of itself, over a loopback socket pair:
   * the `Server` holds one end as a broadcast-only client (no `IoPeer`,
   * since the hub's rows are its local layer already) and a `Connector`
   * over the other end announces to every client and hears every
   * client's announcement the `Server` forwards. The connector's `Db` is
   * a view of the local store that nothing writes through; the connector
   * needs one for its observers only. Modelled after the loopback the
   * `addBroadcastSocket` documentation describes.
   */
  private async openHubChannel(
    server: Server,
    context: RoleContext,
  ): Promise<{ connector: Connector; channel: ConnectorChannel }> {
    const [agentSide, serverSide] = createSocketPair();
    agentSide.connect();
    const origins = new AnnouncementOrigins(agentSide, changeSetsEvents);
    await server.addBroadcastSocket(serverSide);
    const connector = new Connector(
      new Db(new BorrowedIo(this.store.localIo)),
      changeSetsRoute,
      agentSide,
      syncConfig,
      context.selfNodeId ?? undefined,
    );
    return {
      connector,
      channel: new ConnectorChannel(connector, origins, null),
    };
  }

  /**
   * Binds the hub port on every interface. `NetworkManager` closes its
   * probe listener on that port right before it announces the hub role,
   * but the operating system may still report the port as busy for a
   * moment, so a failed bind is retried a few times before it is given up.
   */
  private async listen(httpServer: HttpServer): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => {
            httpServer.removeListener('listening', onListening);
            reject(error);
          };
          const onListening = (): void => {
            httpServer.removeListener('error', onError);
            resolve();
          };
          httpServer.once('error', onError);
          httpServer.once('listening', onListening);
          httpServer.listen(this.hubPort, '0.0.0.0');
        });
        return;
      } catch (error) {
        if (attempt >= this.bindAttempts) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, this.bindRetryDelayMs),
        );
      }
    }
  }

  private async addClient(
    server: Server,
    socket: HubSideSocket,
  ): Promise<void> {
    const address = socket.handshake.address;
    socket.on('disconnect', (reason) => {
      this.logger.info(
        { socketId: socket.id, address, reason },
        'client disconnected from hub',
      );
    });
    // A connection can arrive between `server.tearDown()` and the close
    // of the socket server; `Server.addSocket` has no torn-down guard and
    // would register it and restart the health check.
    if (this.state.role !== 'hub' || this.state.server !== server) {
      socket.disconnect(true);
      return;
    }
    const bridge = new SocketIoBridge(socket);
    const { context } = this.state;
    try {
      await server.addSocket(bridge);
      this.logger.info(
        {
          socketId: socket.id,
          address,
          connectedClients: HubTransport.connectedClientsOf(server),
        },
        'client connected to hub',
      );
    } catch (error) {
      this.lastError = `client ${address} could not be added: ${errorMessage(error)}`;
      this.logger.error(
        { err: error, socketId: socket.id, address },
        'client could not be added to the hub',
      );
      socket.disconnect(true);
      return;
    }
    const nodeId = await this.awaitClientReady(socket, context);
    if (
      nodeId !== undefined &&
      this.state.role === 'hub' &&
      this.state.server === server
    ) {
      this.logger.info(
        { socketId: socket.id, address, nodeId },
        'client ready, catching up with it',
      );
      this.state.channel.peerAttached(
        HubTransport.clientPeer(server, bridge, nodeId),
      );
    }
  }

  /**
   * Runs the ready handshake with a client the server just added:
   * resolves with the node id the client answered with once its `Client`
   * exists, or with `undefined` when it did not answer within
   * `peerInitTimeoutMs` (a client whose initialization failed drops the
   * socket and connects again, which starts over).
   */
  private awaitClientReady(
    socket: HubSideSocket,
    context: RoleContext,
  ): Promise<string | null | undefined> {
    const payload: ReadyPayload = { nodeId: context.selfNodeId };
    return new Promise((resolve) => {
      socket
        .timeout(this.peerInitTimeoutMs)
        .emit(readyEvent, payload, (error: Error | null, answer: unknown) => {
          if (error !== null) {
            this.logger.warn(
              { socketId: socket.id, err: error },
              'client did not answer the ready handshake',
            );
            resolve(undefined);
            return;
          }
          resolve(nodeIdIn(answer));
        });
    });
  }

  private async startClient(
    hubAddress: string,
    context: RoleContext,
  ): Promise<void> {
    const socket = connectToHub(`http://${hubAddress}`, {
      transports: ['websocket'],
      reconnection: true,
      timeout: this.connectTimeoutMs,
      forceNew: true,
    });
    // The origins listen on the bridge before the `Client` builds its
    // `Connector` on it, so that they see every announcement first.
    const bridge = new SocketIoBridge(socket);
    const state: ClientState = {
      role: 'client',
      hubAddress,
      context,
      socket,
      bridge,
      origins: new AnnouncementOrigins(bridge, changeSetsEvents),
      client: null,
      channel: null,
      pendingReady: null,
      connected: false,
    };
    this.state = state;

    socket.on('connect', () => {
      state.connected = true;
      this.logger.info({ hubAddress }, 'socket to hub connected');
      if (state.client === null) {
        void this.transition(() => this.attachClient(state));
      }
    });
    // The hub runs the ready handshake after every `addSocket`, on the
    // first connection and on every reconnection alike; the answer waits
    // until the `Client` exists, and each answer is followed by a
    // catch-up with the hub, since whatever the hub relayed while the
    // socket was down was missed.
    socket.on(
      readyEvent,
      (payload: unknown, acknowledge: (answer: ReadyPayload) => void) => {
        const ready = (): void => {
          acknowledge({ nodeId: state.context.selfNodeId });
          state.channel?.peerAttached(
            HubTransport.hubPeer(
              state.client!,
              nodeIdIn(payload) ?? state.context.hubNodeId,
            ),
          );
        };
        if (state.client !== null && state.channel !== null) {
          ready();
        } else {
          state.pendingReady = ready;
        }
      },
    );
    socket.on('disconnect', (reason) => {
      state.connected = false;
      this.noteError(`disconnected from hub ${hubAddress}: ${reason}`);
      // socket.io reconnects on its own after every reason but a
      // disconnect the server asked for (a hub that shut down), and a hub
      // that comes back behind the same address is the one this node
      // still follows, so the socket is told to keep trying.
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });
    socket.on('connect_error', (error) => {
      this.noteError(`cannot reach hub ${hubAddress}: ${error.message}`);
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Builds the `Client` over the connected socket. Runs as a queued
   * transition of its own, so a teardown that was requested meanwhile
   * runs after it and finds the client to tear down; `state` is stale by
   * then, and the client is dropped again. A `Client` that fails to
   * initialize has already started its peer bridges on the socket, and
   * `Client.tearDown()` leaves them there (`docs/findings/hub-transport.md`),
   * so the socket is dropped with it and a fresh one is tried after
   * `connectTimeoutMs`, rather than letting the next `connect` build a
   * second `Client` on a socket that already answers the hub.
   */
  private async attachClient(state: ClientState): Promise<void> {
    if (this.state !== state || state.client !== null) {
      return;
    }
    let client: Client | null = null;
    try {
      client = new Client(
        state.bridge,
        new BorrowedIo(this.store.localIo),
        this.blobs,
        changeSetsRoute,
        {
          logger: serverLoggerOver(this.logger),
          ownsStores: false,
          syncConfig,
          clientIdentity: state.context.selfNodeId ?? undefined,
        },
      );
      await client.init();
      await client.createTables({ withInsertHistory: [...domainTableCfgs] });
    } catch (error) {
      this.noteError(
        `client over hub ${state.hubAddress} failed to initialize: ${errorMessage(error)}`,
      );
      await client?.tearDown();
      await this.tearDown();
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.becomeClient(state.hubAddress);
      }, this.connectTimeoutMs);
      return;
    }

    state.client = client;
    this.lastError = null;
    this.store.readThrough(() => client.io ?? this.store.localIo);
    this.store.pullThrough(() => {
      const peer = client.peerStores.io;
      return peer === undefined ? [] : [peer];
    });
    this.logger.info({ hubAddress: state.hubAddress }, 'connected to hub');
    if (client.connector !== undefined) {
      const channel = new ConnectorChannel(
        client.connector,
        state.origins,
        state.context.hubNodeId,
      );
      state.channel = channel;
      this.publishChannel(channel);
    }
    const ready = state.pendingReady;
    state.pendingReady = null;
    ready?.();
  }

  /**
   * The hub as a peer the sync agent can list change sets from: the
   * `IoPeer` of the `Client` towards the hub (`peerStores`, the hub alone
   * without this node's own store in front), over which a table dump is
   * answered by the hub's `IoServer` from the hub's own store, never from
   * the other clients.
   */
  private static hubPeer(
    client: Client,
    hubNodeId: string | null,
  ): AttachedPeer {
    const peer = client.peerStores.io;
    return {
      nodeId: hubNodeId,
      heldChangeSets: () => {
        if (peer === undefined) {
          return Promise.reject(new Error('the client has no peer to the hub'));
        }
        return heldChangeSetsOf(peer);
      },
    };
  }

  /** Records a transport failure once per distinct message. */
  private noteError(message: string): void {
    if (this.lastError !== message) {
      this.lastError = message;
      this.logger.warn(message);
    }
  }

  private async tearDown(): Promise<void> {
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const state = this.state;
    this.state = { role: 'standalone' };
    this.store.readThrough(null);
    this.store.pullThrough(null);
    if (this.channel !== null) {
      this.publishChannel(null);
    }

    if (state.role === 'hub') {
      const port = this.boundPortOf(state.httpServer);
      state.connector.tearDown();
      await state.server.tearDown();
      await state.socketServer.close();
      this.logger.info({ port }, 'hub transport stopped');
    } else if (state.role === 'client') {
      state.socket.removeAllListeners();
      if (state.client !== null) {
        await state.client.tearDown();
      }
      state.socket.disconnect();
      this.logger.info(
        { hubAddress: state.hubAddress },
        'disconnected from hub',
      );
    }
  }
}
