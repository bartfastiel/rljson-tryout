// @ts-check
import { liveEvents } from './live-events.js';

/**
 * The side of a partner node a transfer shows on: `upstream` when this
 * node receives from the partner, `downstream` when it sends to it.
 *
 * @typedef {'upstream' | 'downstream'} TransferSide
 */

/**
 * What one side of one partner is doing: `active` while a transfer runs,
 * `trailing` for the second after the last one completed, `failed` for
 * the second after one failed, `idle` otherwise.
 *
 * @typedef {'idle' | 'active' | 'trailing' | 'failed'} ActivityState
 */

/**
 * How long a side keeps showing a transfer after it ended, so that a pull
 * of a few milliseconds is visible at all.
 */
const trailingMs = 1000;

/**
 * The partner key of a transfer that names no node: an announcement the
 * hub made to every connected client at once, which every partner badge
 * shows on its downstream side.
 */
const everyPartner = '*';

const rank = { idle: 0, trailing: 1, failed: 2, active: 3 };

/**
 * Whether a transfer counts as one with the given node: it names that
 * node, or it is a hub's announcement to every client. The node service
 * lists `GET /api/sync/transfers?peer=` by the same rule.
 *
 * @param {import('./status-feed.js').SyncTransfer} transfer
 * @param {string} nodeId
 */
export const concernsPartner = (transfer, nodeId) =>
  transfer.peerNodeId === nodeId ||
  (transfer.direction === 'outgoing' && transfer.peerNodeId === null);

/**
 * Whether a `sync` event marks the start of a pull rather than an
 * outcome: the stream sends `pending` without an error when a pull
 * starts, and `pending` with the error when an attempt ended and the
 * change set stays pending for a retry.
 *
 * @param {import('./status-feed.js').SyncTransfer} transfer
 */
const isStart = (transfer) =>
  transfer.status === 'pending' && transfer.error === undefined;

/**
 * @param {import('./status-feed.js').SyncTransfer} transfer
 * @returns {TransferSide}
 */
export const sideOf = (transfer) =>
  transfer.direction === 'incoming' ? 'upstream' : 'downstream';

/**
 * @typedef {object} SideActivity
 * @property {Set<string>} running the hashes of the transfers in flight
 * @property {ActivityState} state
 * @property {ReturnType<typeof setTimeout> | null} timer
 */

/**
 * Follows the `sync` events of the node's stream and keeps, per partner
 * node and side, whether a transfer is running, just ended or just
 * failed: an incoming `pending` starts the partner's upstream side, the
 * outcome ends it (`trailing` for a second after `completed`, `failed`
 * for a second after a failure), and an outgoing transfer, which the
 * stream reports complete at once, shows as `trailing` on the downstream
 * side of the node it went to, or of every partner for a hub's
 * announcement. Several pulls from one partner at once keep its side
 * active until the last one ended. The header's node bar and the network
 * view subscribe and read `stateOf` for every icon they show.
 */
class TransferActivity {
  /** @type {Map<string, SideActivity>} */
  #sides = new Map();
  /** @type {Set<() => void>} */
  #listeners = new Set();
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  /**
   * Subscribes to every change of any side. The first subscriber starts
   * following the stream, the last one leaving stops it. Returns the
   * function that unsubscribes.
   *
   * @param {() => void} listener
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    this.#unsubscribe ??= liveEvents.on(
      'sync',
      /** @param {import('./status-feed.js').SyncTransfer} transfer */ (
        transfer,
      ) => this.#onTransfer(transfer),
    );
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#reset();
      }
    };
  }

  /**
   * The state of one side of one partner: the partner's own state or,
   * on the downstream side, the state of the hub's announcements to
   * every client, whichever says more.
   *
   * @param {string} nodeId
   * @param {TransferSide} side
   * @returns {ActivityState}
   */
  stateOf(nodeId, side) {
    const own = this.#sides.get(TransferActivity.#key(nodeId, side));
    const shared =
      side === 'downstream'
        ? this.#sides.get(TransferActivity.#key(everyPartner, side))
        : undefined;
    const ownState = own?.state ?? 'idle';
    const sharedState = shared?.state ?? 'idle';
    return rank[sharedState] > rank[ownState] ? sharedState : ownState;
  }

  /**
   * @param {string} nodeId
   * @param {TransferSide} side
   */
  static #key(nodeId, side) {
    return `${side}\n${nodeId}`;
  }

  /**
   * @param {import('./status-feed.js').SyncTransfer} transfer
   */
  #onTransfer(transfer) {
    const side = sideOf(transfer);
    const partner = transfer.peerNodeId ?? everyPartner;
    if (transfer.peerNodeId === null && transfer.direction === 'incoming') {
      return;
    }
    const key = TransferActivity.#key(partner, side);
    const activity = this.#sides.get(key) ?? {
      running: new Set(),
      state: 'idle',
      timer: null,
    };
    this.#sides.set(key, activity);
    if (activity.timer !== null) {
      clearTimeout(activity.timer);
      activity.timer = null;
    }
    if (isStart(transfer)) {
      activity.running.add(transfer.changeSetHash);
      this.#setState(activity, 'active');
      return;
    }
    activity.running.delete(transfer.changeSetHash);
    if (activity.running.size > 0) {
      this.#setState(activity, 'active');
      return;
    }
    this.#setState(
      activity,
      transfer.status === 'completed' ? 'trailing' : 'failed',
    );
    activity.timer = setTimeout(() => {
      activity.timer = null;
      this.#setState(activity, 'idle');
    }, trailingMs);
  }

  /**
   * @param {SideActivity} activity
   * @param {ActivityState} state
   */
  #setState(activity, state) {
    if (activity.state === state) {
      return;
    }
    activity.state = state;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #reset() {
    for (const activity of this.#sides.values()) {
      if (activity.timer !== null) {
        clearTimeout(activity.timer);
      }
    }
    this.#sides.clear();
  }
}

export const transferActivity = new TransferActivity();
