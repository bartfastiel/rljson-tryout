// @ts-check

/**
 * The payload of the `insert` event of `GET /api/events`: one change set
 * this node wrote itself, with the rows it named per table and the ids
 * of the entities it wrote.
 *
 * @typedef {object} InsertEvent
 * @property {string} changeSetHash
 * @property {string} changeSetId
 * @property {Record<string, number>} tables
 * @property {string[]} entityIds
 */

/**
 * The state of the connection to the node's event stream: `live` while
 * the stream is open, `reconnecting` while the browser or this module is
 * trying to open it (also before the first connection), `offline` while
 * the browser reports no network at all.
 *
 * @typedef {'live' | 'reconnecting' | 'offline'} LiveState
 */

/** @typedef {(state: LiveState) => void} StateListener */

/**
 * The events the node streams and this module dispatches by name. The
 * `conflict` event of the contract is reserved for a later slice and not
 * listened to yet.
 */
const eventNames = /** @type {const} */ (['insert', 'sync', 'topology']);

/** @typedef {(typeof eventNames)[number]} LiveEventName */

/**
 * How long this module waits before it opens the stream again after the
 * browser gave the connection up for good (an error response, which
 * `EventSource` does not retry on its own; a proxy answers one while the
 * node restarts), and how long a burst of events is collected before the
 * views refresh once.
 */
const reopenDelayMs = 5000;
const refreshDebounceMs = 300;

/**
 * One `EventSource` to `/api/events` for the whole page, opened with the
 * first subscriber and kept open: the browser reconnects on its own after
 * a dropped connection, this module reopens after a fatal one and after
 * the browser comes back online, and the header's indicator shows the
 * state. Listeners subscribe per event name and receive the parsed JSON
 * payload.
 */
class LiveEvents {
  /** @type {EventSource | null} */
  #source = null;
  /** @type {LiveState} */
  #state = navigator.onLine ? 'reconnecting' : 'offline';
  /** @type {Map<LiveEventName, Set<(payload: unknown) => void>>} */
  #listeners = new Map(eventNames.map((name) => [name, new Set()]));
  /** @type {Set<StateListener>} */
  #stateListeners = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  #reopenTimer = null;
  #everLive = false;
  /** Whether anything subscribed yet, which is when the stream is due. */
  #wanted = false;

  constructor() {
    window.addEventListener('offline', () => {
      this.#close();
      this.#setState('offline');
    });
    window.addEventListener('online', () => {
      this.#setState('reconnecting');
      if (this.#wanted) {
        this.#open();
      }
    });
  }

  /** The current connection state. */
  get state() {
    return this.#state;
  }

  /** Whether the stream was open at some point since the page loaded. */
  get everLive() {
    return this.#everLive;
  }

  /**
   * Subscribes to the changes of the connection state. Returns the
   * function that unsubscribes.
   *
   * @param {StateListener} listener
   */
  onState(listener) {
    this.#stateListeners.add(listener);
    this.#ensureOpen();
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  /**
   * Subscribes to one event of the stream. The first subscriber of the
   * page opens the connection. Returns the function that unsubscribes.
   *
   * @template Payload
   * @param {LiveEventName} name
   * @param {(payload: Payload) => void} listener
   */
  on(name, listener) {
    const listeners = this.#listeners.get(name);
    if (listeners === undefined) {
      throw new Error(`The event stream has no event called "${name}".`);
    }
    const typed = /** @type {(payload: unknown) => void} */ (listener);
    listeners.add(typed);
    this.#ensureOpen();
    return () => {
      listeners.delete(typed);
    };
  }

  /** Opens the stream for the first subscriber; later ones share it. */
  #ensureOpen() {
    this.#wanted = true;
    if (this.#source === null && this.#reopenTimer === null) {
      this.#open();
    }
  }

  #open() {
    if (this.#reopenTimer !== null) {
      clearTimeout(this.#reopenTimer);
      this.#reopenTimer = null;
    }
    this.#close();
    const source = new EventSource('/api/events');
    this.#source = source;
    source.addEventListener('open', () => {
      this.#everLive = true;
      this.#setState('live');
    });
    source.addEventListener('error', () => {
      if (source !== this.#source) {
        return;
      }
      if (source.readyState === EventSource.CLOSED) {
        this.#close();
        this.#reopenTimer = setTimeout(() => {
          this.#reopenTimer = null;
          this.#open();
        }, reopenDelayMs);
      }
      this.#setState(navigator.onLine ? 'reconnecting' : 'offline');
    });
    for (const name of eventNames) {
      source.addEventListener(name, (event) => {
        this.#dispatch(name, /** @type {MessageEvent<string>} */ (event));
      });
    }
  }

  #close() {
    if (this.#source !== null) {
      this.#source.close();
      this.#source = null;
    }
  }

  /**
   * @param {LiveEventName} name
   * @param {MessageEvent<string>} event
   */
  #dispatch(name, event) {
    const payload = JSON.parse(event.data);
    for (const listener of this.#listeners.get(name) ?? []) {
      listener(payload);
    }
  }

  /**
   * @param {LiveState} state
   */
  #setState(state) {
    if (state === this.#state) {
      return;
    }
    this.#state = state;
    for (const listener of this.#stateListeners) {
      listener(state);
    }
  }
}

export const liveEvents = new LiveEvents();

/**
 * Whether an event that names rows per table touches any of the given
 * tables.
 *
 * @param {{ tables: Record<string, number> }} event
 * @param {readonly string[]} tables
 */
const touches = (event, tables) =>
  Object.keys(event.tables).some((table) => tables.includes(table));

/**
 * Calls `refresh` when the data a view shows may have changed on this
 * node: an `insert` naming one of the given tables, a completed incoming
 * `sync` naming one of them, or the stream coming back after it was
 * down, when anything may have been missed. A burst of change sets ends
 * in one call, `refreshDebounceMs` after the last event; `refresh`
 * receives the tables the events named, or `null` after a reconnection.
 * Returns the function that unsubscribes.
 *
 * @param {readonly string[]} tables
 * @param {(changed: ReadonlySet<string> | null) => void} refresh
 */
export const refreshOnChange = (tables, refresh) => {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Set<string> | null} */
  let changed = new Set();

  /**
   * @param {ReadonlySet<string> | null} tablesChanged
   */
  const schedule = (tablesChanged) => {
    if (changed !== null) {
      if (tablesChanged === null) {
        changed = null;
      } else {
        for (const table of tablesChanged) {
          changed.add(table);
        }
      }
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const batch = changed;
      changed = new Set();
      refresh(batch);
    }, refreshDebounceMs);
  };

  const unsubscribes = [
    liveEvents.on(
      'insert',
      /** @param {InsertEvent} event */ (event) => {
        if (touches(event, tables)) {
          schedule(new Set(Object.keys(event.tables)));
        }
      },
    ),
    liveEvents.on(
      'sync',
      /** @param {import('./status-feed.js').SyncTransfer} transfer */ (
        transfer,
      ) => {
        if (
          transfer.direction === 'incoming' &&
          transfer.status === 'completed' &&
          touches(transfer, tables)
        ) {
          schedule(new Set(Object.keys(transfer.tables)));
        }
      },
    ),
    liveEvents.onState((state) => {
      if (state === 'live') {
        schedule(null);
      }
    }),
  ];

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
};
