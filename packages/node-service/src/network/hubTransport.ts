import { createServer, type Server as HttpServer } from 'node:http';

import type { Bs } from '@rljson/bs';
import { Route } from '@rljson/rljson';
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
import { domainTableCfgs, type PetShopStore } from '../store/petShopStore.ts';

/**
 * The one route every node relays (roadmap section 3.4): a hub of
 * `@rljson/server` multicasts references of exactly one route, and this
 * project announces change set hashes on it from slice D3 on.
 */
export const changeSetsRoute = Route.fromFlat('changeSets');

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
 * `@rljson/server` and the switch that routes the store's reads through
 * the active multi.
 */
export type TransportStore = Pick<PetShopStore, 'localIo' | 'readThrough'>;

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
}>;

type HubState = {
  role: 'hub';
  hubAddress: string | null;
  httpServer: HttpServer;
  socketServer: SocketIoServer;
  server: Server;
};

type ClientState = {
  role: 'client';
  hubAddress: string;
  socket: ClientSocket;
  client: Client | null;
  connected: boolean;
};

type TransportState = { role: 'standalone' } | HubState | ClientState;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
 * through the hub, to every other client, while writes stay local. Every
 * domain table is created on the `Server` or `Client` as
 * `docs/roadmap.md` section 3.2 asks, a no-op after the store created
 * them. The hub port is bound by the socket.io server itself, which also
 * answers the TCP probes of the other nodes (`docs/findings/network-discovery.md`).
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
  private state: TransportState = { role: 'standalone' };
  private lastError: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;

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
  }

  /**
   * Starts serving the node's store on the hub port. `hubAddress` is the
   * address the other nodes use for this hub, as discovery reports it;
   * the socket.io server itself binds every interface. A node that is
   * already the hub keeps its server.
   */
  becomeHub(hubAddress: string | null): Promise<void> {
    return this.transition(async () => {
      if (this.state.role === 'hub') {
        this.state.hubAddress = hubAddress;
        return;
      }
      await this.tearDown();
      await this.startHub(hubAddress);
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
  becomeClient(hubAddress: string): Promise<void> {
    return this.transition(async () => {
      if (
        this.state.role === 'client' &&
        this.state.hubAddress === hubAddress
      ) {
        return;
      }
      await this.tearDown();
      await this.startClient(hubAddress);
    });
  }

  /** Releases the hub port or the connection to the hub. */
  becomeStandalone(): Promise<void> {
    return this.transition(() => this.tearDown());
  }

  stop(): Promise<void> {
    return this.becomeStandalone();
  }

  snapshot(): TransportSnapshot {
    const state = this.state;
    if (state.role === 'hub') {
      return {
        role: 'hub',
        hubAddress: state.hubAddress,
        connectedClients: state.server.clients.size,
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

  private async startHub(hubAddress: string | null): Promise<void> {
    const server = new Server(
      changeSetsRoute,
      new BorrowedIo(this.store.localIo),
      this.blobs,
      { logger: serverLoggerOver(this.logger) },
    );
    await server.init();
    await server.createTables({ withInsertHistory: [...domainTableCfgs] });

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
      await server.tearDown();
      throw error;
    }

    this.state = { role: 'hub', hubAddress, httpServer, socketServer, server };
    this.lastError = null;
    this.store.readThrough(() => server.io);
    this.logger.info(
      { port: this.boundPort(), hubAddress },
      'hub transport serving',
    );
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
    try {
      await server.addSocket(new SocketIoBridge(socket));
      this.logger.info(
        { socketId: socket.id, address, connectedClients: server.clients.size },
        'client connected to hub',
      );
    } catch (error) {
      this.lastError = `client ${address} could not be added: ${errorMessage(error)}`;
      this.logger.error(
        { err: error, socketId: socket.id, address },
        'client could not be added to the hub',
      );
      socket.disconnect(true);
    }
  }

  private async startClient(hubAddress: string): Promise<void> {
    const socket = connectToHub(`http://${hubAddress}`, {
      transports: ['websocket'],
      reconnection: true,
      timeout: this.connectTimeoutMs,
      forceNew: true,
    });
    const state: ClientState = {
      role: 'client',
      hubAddress,
      socket,
      client: null,
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
        new SocketIoBridge(state.socket),
        new BorrowedIo(this.store.localIo),
        this.blobs,
        changeSetsRoute,
        { logger: serverLoggerOver(this.logger), ownsStores: false },
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
    this.logger.info({ hubAddress: state.hubAddress }, 'connected to hub');
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

    if (state.role === 'hub') {
      const port = this.boundPortOf(state.httpServer);
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
