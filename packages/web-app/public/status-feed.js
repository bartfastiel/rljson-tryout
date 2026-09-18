// @ts-check
import { fetchJson } from './api.js';
import { liveEvents } from './live-events.js';

/**
 * One node of the environment as `GET /status` lists it under `nodes`:
 * the link a browser can open, what the node reported about itself when
 * this node last polled it, and the two flags this node has for it.
 *
 * @typedef {object} StatusNode
 * @property {string} url
 * @property {boolean} self
 * @property {string | null} name
 * @property {string | null} nodeId
 * @property {string | null} role
 * @property {number | null} connectedClients
 * @property {boolean} reachable
 * @property {string | null} lastSeen
 * @property {boolean} seenInTopology
 */

/**
 * One peer as discovery knows it, from `GET /status` under `peers`.
 *
 * @typedef {object} StatusPeer
 * @property {string} nodeId
 * @property {string | null} name
 * @property {string} hostname
 * @property {string[]} addresses
 * @property {number} port
 * @property {'hub' | 'client' | null} role
 * @property {string} startedAt
 * @property {string} firstSeen
 * @property {string} lastSeen
 * @property {{ reachable: boolean, latencyMs: number | null, measuredAt: string } | null} probe
 */

/**
 * The state of the hub transport, from `GET /status` under `transport`:
 * as hub how many clients it holds, as client whether it is connected to
 * the hub, and the last failure of the transport when there was one.
 *
 * @typedef {object} StatusTransport
 * @property {'standalone' | 'hub' | 'client'} role
 * @property {string | null} hubAddress
 * @property {number} [connectedClients]
 * @property {boolean} [connectedToHub]
 * @property {string | null} lastError
 */

/**
 * One blob a pull fetched from the network with the rows: its id and
 * its size in bytes.
 *
 * @typedef {object} TransferredBlob
 * @property {string} blobId
 * @property {number} bytes
 */

/**
 * One change set transfer, from `GET /status` under `sync.transfers`:
 * which way it went, the node it came from or went to (`null` when the
 * announcement named none, or for a hub announcing to every client), the
 * change set by hash and id, the rows it named per table, the blobs the
 * pull fetched (absent when none), how long the pull took, when it
 * finished and how it ended.
 *
 * @typedef {object} SyncTransfer
 * @property {'incoming' | 'outgoing'} direction
 * @property {string | null} peerNodeId
 * @property {string} changeSetHash
 * @property {string | null} changeSetId
 * @property {Record<string, number>} tables
 * @property {TransferredBlob[]} [blobs] the blobs the pull fetched with the rows
 * @property {number} durationMs
 * @property {string} at
 * @property {'completed' | 'pending' | 'failed'} status
 * @property {string} [error]
 */

/**
 * The change set synchronisation of this node, from `GET /status` under
 * `sync`: the counters and the last ten transfers, newest first.
 *
 * @typedef {object} StatusSync
 * @property {number} announced
 * @property {number} received
 * @property {number} skipped
 * @property {number} pending
 * @property {number} failed
 * @property {string | null} lastError
 * @property {SyncTransfer[]} transfers
 */

/**
 * The answer of `GET /status`.
 *
 * @typedef {object} Status
 * @property {string} nodeName
 * @property {string | null} nodeId
 * @property {string} publicUrl
 * @property {string} domain
 * @property {'starting' | 'standalone' | 'hub' | 'client'} role
 * @property {string | null} hubNodeId
 * @property {string | null} hubAddress
 * @property {StatusPeer[]} peers
 * @property {StatusNode[]} nodes
 * @property {StatusTransport} transport
 * @property {StatusSync} sync
 * @property {string} storage
 * @property {Record<string, number>} tables
 */

/**
 * What every subscriber receives after each refresh: the status (or the
 * error the node answered with), the result of this browser's own
 * `GET /health` probe per node URL, and when the refresh finished.
 *
 * @typedef {object} StatusUpdate
 * @property {Status | null} status
 * @property {unknown} error
 * @property {Map<string, boolean>} browserProbes
 * @property {Date} at
 */

/** @typedef {(update: StatusUpdate) => void} StatusListener */

/**
 * The poll is the fallback for a stream that is down and the schedule of
 * the browser probes; the events of the stream refresh the status within
 * `eventDebounceMs`, so a burst of transfers ends in one request.
 */
const refreshIntervalMs = 30000;
const eventDebounceMs = 300;
const probeTimeoutMs = 3000;

/**
 * Whether this browser itself can reach the given node: a cross-origin
 * `GET /health` that the node allows (`access-control-allow-origin`), with
 * a short timeout so that an unreachable node does not hold a refresh up.
 *
 * @param {string} url
 */
const probeFromBrowser = async (url) => {
  try {
    const response = await fetch(`${url}/health`, {
      mode: 'cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Reads `GET /status` of this node while anyone listens and hands the
 * result to every subscriber: right away on the `topology` and `sync`
 * events of the live stream (the status carries the same topology plus
 * the transfer list and counters, so one read serves every view), and
 * every thirty seconds as the fallback while the stream is down and as
 * the schedule of the browser's own `GET /health` probes of the other
 * nodes, which take up to three seconds for an unreachable node and would
 * hold an event-driven refresh up; those refreshes reuse the last probe
 * results. The header's node bar and the network view share one feed, so
 * the page never reads the status twice for one change.
 */
class StatusFeed {
  /** @type {Set<StatusListener>} */
  #listeners = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #eventTimer = null;
  /** @type {(() => void)[]} */
  #unsubscribeEvents = [];
  /** @type {StatusUpdate | null} */
  #latest = null;
  /** @type {Map<string, boolean>} */
  #browserProbes = new Map();
  /** @type {Promise<void> | null} */
  #refreshing = null;
  #again = false;

  /**
   * Starts reading with the first subscriber and stops with the last one.
   * A new subscriber receives the latest update right away when there is
   * one. Returns the function that unsubscribes.
   *
   * @param {StatusListener} listener
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    if (this.#latest !== null) {
      listener(this.#latest);
    }
    if (this.#listeners.size === 1) {
      this.#followEvents();
      void this.refresh();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stop();
      }
    };
  }

  /**
   * Refreshes now, probes included, instead of at the next tick, for
   * example after the user pressed Retry. Concurrent calls share one
   * refresh.
   */
  refresh() {
    return this.#refresh(true);
  }

  #followEvents() {
    const onEvent = () => this.#scheduleEventRefresh();
    this.#unsubscribeEvents = [
      liveEvents.on('topology', onEvent),
      liveEvents.on('sync', onEvent),
      liveEvents.onState((state) => {
        if (state === 'live') {
          onEvent();
        }
      }),
    ];
  }

  #scheduleEventRefresh() {
    if (this.#eventTimer !== null) {
      clearTimeout(this.#eventTimer);
    }
    this.#eventTimer = setTimeout(() => {
      this.#eventTimer = null;
      void this.#refresh(false);
    }, eventDebounceMs);
  }

  #stop() {
    for (const unsubscribe of this.#unsubscribeEvents.splice(0)) {
      unsubscribe();
    }
    for (const timer of [this.#timer, this.#eventTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    this.#timer = null;
    this.#eventTimer = null;
    this.#again = false;
  }

  /**
   * Runs one cycle, or notes that another one is due when a cycle is
   * running: an event that arrives while the status is being read may
   * postdate the answer, so the read is repeated once the cycle is done.
   *
   * @param {boolean} probe whether to run the browser probes again
   */
  #refresh(probe) {
    if (this.#refreshing !== null) {
      this.#again = true;
      return this.#refreshing;
    }
    this.#refreshing = this.#cycle(probe).finally(() => {
      this.#refreshing = null;
      if (this.#again && this.#listeners.size > 0) {
        this.#again = false;
        void this.#refresh(false);
      }
    });
    return this.#refreshing;
  }

  /**
   * @param {boolean} probe
   */
  async #cycle(probe) {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    /** @type {StatusUpdate} */
    const update = {
      status: null,
      error: null,
      browserProbes: this.#browserProbes,
      at: new Date(),
    };
    try {
      update.status = /** @type {Status} */ (await fetchJson('/status'));
      if (probe) {
        this.#browserProbes = await this.#probeOthers(update.status);
        update.browserProbes = this.#browserProbes;
      }
    } catch (error) {
      update.error = error;
    }
    update.at = new Date();
    this.#latest = update;

    for (const listener of this.#listeners) {
      listener(update);
    }
    if (this.#listeners.size > 0) {
      this.#timer = setTimeout(() => void this.refresh(), refreshIntervalMs);
    }
  }

  /**
   * @param {Status} status
   */
  async #probeOthers(status) {
    const others = status.nodes.filter((node) => !node.self);
    const results = await Promise.all(
      others.map((node) => probeFromBrowser(node.url)),
    );
    return new Map(others.map((node, index) => [node.url, results[index]]));
  }
}

export const statusFeed = new StatusFeed();
