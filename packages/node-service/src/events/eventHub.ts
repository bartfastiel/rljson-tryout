import type { FastifyBaseLogger } from 'fastify';

/**
 * The names of the events `GET /api/events` streams (roadmap section
 * 2.5): `insert` when this node writes a change set itself, `sync` for
 * every change set transfer the `SyncAgent` records, `topology` whenever
 * the network snapshot changes. The fourth name of the contract,
 * `conflict`, is reserved for slice D11 and not emitted yet.
 */
export type LiveEventName = 'insert' | 'sync' | 'topology';

/**
 * What the hub needs from a connected client: the writable side of the
 * HTTP response. `write` reports whether the data was taken by the
 * socket or buffered, `writableLength` how much is buffered, and a client
 * that stops reading is destroyed once that exceeds the bound.
 */
export type EventSink = {
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  readonly writableLength: number;
  readonly writableEnded: boolean;
};

export type EventHubOptions = Readonly<{
  /** How often a comment line keeps idle connections alive. */
  heartbeatIntervalMs?: number;
  /** The reconnection delay the stream advises the browser to use. */
  retryDelayMs?: number;
  /** How much a client may leave unread before it is dropped. */
  maxBufferedBytes?: number;
}>;

/**
 * Formats one server-sent event: the event id, the event name and the
 * payload as one `data` line, terminated by the blank line the protocol
 * ends an event with. The JSON never contains a raw line break, so one
 * `data` line carries it.
 */
export const formatEvent = (
  id: number,
  name: LiveEventName,
  data: unknown,
): string => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Fans the live events of this node out to every connected `GET
 * /api/events` client. Every event carries an id that counts up for the
 * lifetime of the process, a client that stops reading is dropped once
 * its unread data exceeds `maxBufferedBytes` (nothing is ever queued per
 * client beyond the socket's own buffer), a comment heartbeat every
 * `heartbeatIntervalMs` keeps proxies from closing an idle stream, and
 * `close` ends every stream so that the HTTP server can shut down.
 */
export class EventHub {
  private readonly logger: FastifyBaseLogger;
  private readonly heartbeatIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxBufferedBytes: number;
  private readonly sinks = new Set<EventSink>();
  private heartbeat: NodeJS.Timeout | null = null;
  private lastEventId = 0;
  private closed = false;

  constructor(logger: FastifyBaseLogger, options: EventHubOptions = {}) {
    this.logger = logger;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.retryDelayMs = options.retryDelayMs ?? 3_000;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 1_048_576;
  }

  /** How many clients are connected right now. */
  get clientCount(): number {
    return this.sinks.size;
  }

  /** The id of the last event published, `0` before the first. */
  get lastId(): number {
    return this.lastEventId;
  }

  /**
   * Adds a client: sends it the reconnection delay and a comment that
   * confirms the connection, and starts the heartbeat with the first
   * client. Returns the function that removes the client again, which
   * the caller runs when the request closes; a client added after
   * `close` is ended right away.
   */
  add(sink: EventSink): () => void {
    if (this.closed) {
      sink.end();
      return () => undefined;
    }
    this.sinks.add(sink);
    this.deliver(sink, `retry: ${this.retryDelayMs}\n\n: connected\n\n`);
    if (this.heartbeat === null) {
      this.heartbeat = setInterval(
        () => this.broadcast(': heartbeat\n\n'),
        this.heartbeatIntervalMs,
      );
      this.heartbeat.unref();
    }
    this.logger.debug({ clients: this.sinks.size }, 'event stream opened');
    return () => this.remove(sink);
  }

  /** Sends one event to every connected client. */
  publish(name: LiveEventName, data: unknown): void {
    if (this.closed) {
      return;
    }
    this.lastEventId += 1;
    this.broadcast(formatEvent(this.lastEventId, name, data));
  }

  /** Ends every stream; later clients are ended as they arrive. */
  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    const sinks = [...this.sinks];
    this.sinks.clear();
    for (const sink of sinks) {
      if (!sink.writableEnded) {
        sink.end();
      }
    }
  }

  /**
   * Writes to every client. A `Set` skips what a `deliver` removed while
   * the loop runs, so the set is iterated as it is.
   */
  private broadcast(chunk: string): void {
    for (const sink of this.sinks) {
      this.deliver(sink, chunk);
    }
  }

  /**
   * Writes to one client and drops it when it has fallen too far behind:
   * `write` buffers in the process what the socket cannot take, so a
   * client that stopped reading would grow the process with every event
   * until it is cut off.
   */
  private deliver(sink: EventSink, chunk: string): void {
    if (sink.writableEnded) {
      this.remove(sink);
      return;
    }
    sink.write(chunk);
    if (sink.writableLength > this.maxBufferedBytes) {
      this.logger.warn(
        { bufferedBytes: sink.writableLength },
        'event stream client is not reading, dropped',
      );
      this.remove(sink);
      sink.destroy();
    }
  }

  private remove(sink: EventSink): void {
    if (!this.sinks.delete(sink)) {
      return;
    }
    this.logger.debug({ clients: this.sinks.size }, 'event stream closed');
    if (this.sinks.size === 0) {
      this.stopHeartbeat();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
