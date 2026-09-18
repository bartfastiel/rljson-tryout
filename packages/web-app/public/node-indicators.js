// @ts-check
import { openTransferDialog } from './components/transfer-dialog.js';
import { element } from './dom.js';
import { transferIcon } from './transfer-icon.js';

/**
 * The small indicators the header's node bar and the network view share
 * for a node of the environment: whether discovery on this node
 * currently sees it (the primary signal, from UDP broadcast and TCP
 * probing on the server side), whether this very browser could reach it
 * (the secondary signal, from the browser's own `GET /health` probe),
 * the hub's client count, and the upstream and downstream transfer
 * icons with the popup behind them. The colour indicators carry a
 * visually hidden label so that the colour never stands alone.
 */

/**
 * @param {import('./status-feed.js').StatusNode} node
 */
export const nodeLabel = (node) => node.name ?? new URL(node.url).host;

/**
 * The upstream and downstream icons of a partner node, as the header's
 * badges and the network view's cards show them; `applyActivityTo` of
 * `transfer-icon.js` brings them to the current state.
 *
 * @param {import('./status-feed.js').StatusNode} node
 */
export const transferIcons = (node) => {
  const icons = element('span', 'transfer-icons');
  icons.append(
    transferIcon('upstream', node.nodeId ?? '', nodeLabel(node)),
    transferIcon('downstream', node.nodeId ?? '', nodeLabel(node)),
  );
  return icons;
};

/**
 * Opens the transfer popup for a partner node from the given element,
 * which gets the focus back when the popup closes.
 *
 * @param {import('./status-feed.js').StatusNode} node
 * @param {HTMLElement} opener
 */
export const openTransfersOf = (node, opener) =>
  openTransferDialog(
    { nodeId: node.nodeId, name: nodeLabel(node), url: node.url },
    opener,
  );

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
 * The number of clients a hub holds on its hub transport, as a small pill
 * next to the node's name, or nothing for a node that is not the hub (the
 * count is `null` then). Read by screen readers as "2 connected clients".
 *
 * @param {number | null} connectedClients
 */
export const connectedClientsBadge = (connectedClients) => {
  if (connectedClients === null) {
    return null;
  }
  const label = `${connectedClients} connected ${connectedClients === 1 ? 'client' : 'clients'}`;
  const badge = element('span', 'node-clients');
  badge.title = label;
  badge.append(
    element('span', 'node-clients-count', String(connectedClients)),
    element('span', 'visually-hidden', ` ${label}`),
  );
  return badge;
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
