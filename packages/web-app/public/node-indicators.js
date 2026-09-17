// @ts-check
import { element } from './dom.js';

/**
 * The two small indicators the header's node bar and the network view
 * share for a node of the environment: whether discovery on this node
 * currently sees it (the primary signal, from UDP broadcast and TCP
 * probing on the server side) and whether this very browser could reach
 * it (the secondary signal, from the browser's own `GET /health` probe).
 * Both carry a visually hidden label so that the colour never stands
 * alone.
 */

/**
 * A round dot, green when discovery sees the node and red otherwise.
 *
 * @param {boolean} seenInTopology
 */
export const topologyDot = (seenInTopology) => {
  const dot = element(
    'span',
    `topology-dot ${seenInTopology ? 'topology-dot-seen' : 'topology-dot-unseen'}`,
  );
  dot.append(
    element(
      'span',
      'visually-hidden',
      seenInTopology
        ? 'in the discovery topology'
        : 'not in the discovery topology',
    ),
  );
  return dot;
};

/**
 * A small marker for the browser's own probe: a check when this browser
 * reached the node, a cross when it did not, and a hollow marker while
 * the probe has not run yet.
 *
 * @param {boolean | undefined} reachableFromBrowser
 */
export const browserProbeMarker = (reachableFromBrowser) => {
  let state = 'browser-probe-pending';
  let label = 'browser probe pending';
  if (reachableFromBrowser === true) {
    state = 'browser-probe-ok';
    label = 'reachable from your browser';
  } else if (reachableFromBrowser === false) {
    state = 'browser-probe-failed';
    label = 'not reachable from your browser';
  }
  const marker = element('span', `browser-probe ${state}`);
  marker.title = label;
  marker.append(element('span', 'visually-hidden', label));
  return marker;
};
