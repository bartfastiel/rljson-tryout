// @ts-check
import { fetchJson } from './api.js';

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

const refreshIntervalMs = 5000;
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
 * Polls `GET /status` of this node every five seconds while anyone
 * listens, probes every other node of the environment from the browser
 * after each poll, and hands the result to every subscriber. The header's
 * node bar and the network view share one feed, so the page never polls
 * twice. (Slice B13 replaces the polling by server-sent events.)
 */
class StatusFeed {
  /** @type {Set<StatusListener>} */
  #listeners = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  /** @type {StatusUpdate | null} */
  #latest = null;
  /** @type {Promise<void> | null} */
  #refreshing = null;

  /**
   * Starts polling with the first subscriber and stops with the last one.
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
      void this.refresh();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
    };
  }

  /**
   * Refreshes now instead of at the next tick, for example after the user
   * pressed Retry. Concurrent calls share one refresh.
   */
  refresh() {
    if (this.#refreshing === null) {
      this.#refreshing = this.#cycle().finally(() => {
        this.#refreshing = null;
      });
    }
    return this.#refreshing;
  }

  async #cycle() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    /** @type {StatusUpdate} */
    const update = {
      status: null,
      error: null,
      browserProbes: new Map(),
      at: new Date(),
    };
    try {
      update.status = /** @type {Status} */ (await fetchJson('/status'));
      const others = update.status.nodes.filter((node) => !node.self);
      const results = await Promise.all(
        others.map((node) => probeFromBrowser(node.url)),
      );
      others.forEach((node, index) => {
        update.browserProbes.set(node.url, results[index]);
      });
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
}

export const statusFeed = new StatusFeed();
