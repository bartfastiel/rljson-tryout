// @ts-check
import { element } from '../dom.js';
import {
  browserProbeMarker,
  connectedClientsBadge,
  nodeLabel,
  openTransfersOf,
  topologyDot,
  transferIcons,
} from '../node-indicators.js';
import { statusFeed } from '../status-feed.js';
import { transferActivity } from '../transfer-activity.js';
import { applyActivityTo } from '../transfer-icon.js';
import {
  errorState,
  formatRelativeTime,
  statusMessage,
  timeFormat,
} from '../view-helpers.js';

const viewTitle = () => element('h1', 'view-title', 'Network');

/**
 * @param {string} title
 * @param {HTMLElement} content
 */
const section = (title, content) => {
  const created = element('section', 'network-section');
  created.append(element('h2', 'network-section-title', title), content);
  return created;
};

/**
 * @param {[string, string | HTMLElement][]} rows
 */
const facts = (rows) => {
  const list = element('dl', 'facts');
  for (const [term, value] of rows) {
    const definition = element('dd', '');
    definition.append(value);
    list.append(element('dt', '', term), definition);
  }
  return list;
};

/**
 * @param {string | null} role
 */
const roleBadge = (role) =>
  element('span', `role-badge role-${role ?? 'unknown'}`, role ?? 'unknown');

/**
 * @param {string | null} nodeId
 */
const nodeIdCode = (nodeId) =>
  element('code', 'node-id', nodeId ?? 'not known yet');

/**
 * Whether a node's id was restored from its data directory or generated
 * at this start, as a badge; nothing for a node that reported no
 * identity (yet).
 *
 * @param {import('../status-feed.js').StatusIdentity | null | undefined} identity
 */
const identityBadge = (identity) => {
  if (identity === null || identity === undefined) {
    return null;
  }
  const badge = element(
    'span',
    `identity-badge identity-${identity.persistent ? 'persistent' : 'fresh'}`,
    identity.persistent ? 'persistent id' : 'fresh id',
  );
  badge.title = identity.persistent
    ? 'The node id was restored from the data directory; it survives restarts'
    : 'The node id was generated when the process started';
  return badge;
};

/**
 * Where this node's id comes from, in one sentence, with the path of the
 * identity file when there is one.
 *
 * @param {import('../status-feed.js').Status['identity'] | undefined} identity
 */
const identitySummary = (identity) => {
  if (identity === null || identity === undefined) {
    return 'not known yet';
  }
  const origin = identity.persistent
    ? 'persistent id, restored from the data directory'
    : 'fresh id, generated at this start';
  return identity.identityPath === null
    ? `${origin}, not written to disk`
    : `${origin} (${identity.identityPath})`;
};

/**
 * A yes or no signal row for the node cards: a marker element, then the
 * wording for the state, so that colour and text always agree.
 *
 * @param {HTMLElement} marker
 * @param {string} text
 */
const signal = (marker, text) => {
  const item = element('li', 'node-signal');
  item.append(marker, element('span', 'node-signal-text', text));
  return item;
};

/**
 * @param {boolean} reachable
 */
const probeMarker = (reachable) => {
  const marker = element(
    'span',
    `probe-mark ${reachable ? 'probe-mark-ok' : 'probe-mark-failed'}`,
  );
  marker.setAttribute('aria-hidden', 'true');
  return marker;
};

/**
 * What the hub transport is doing, in one sentence: serving, connected,
 * trying, or idle, with the last failure when there was one.
 *
 * @param {import('../status-feed.js').StatusTransport} transport
 */
const transportSummary = (transport) => {
  let text = 'idle, this node runs on its own';
  if (transport.role === 'hub') {
    const count = transport.connectedClients ?? 0;
    text = `serving ${count} connected ${count === 1 ? 'client' : 'clients'}`;
  } else if (transport.role === 'client') {
    text = transport.connectedToHub
      ? `connected to the hub at ${transport.hubAddress ?? ''}`
      : `not connected to the hub at ${transport.hubAddress ?? ''}`;
  }
  if (transport.lastError !== null) {
    text = `${text}; last error: ${transport.lastError}`;
  }
  return text;
};

/**
 * @param {import('../status-feed.js').Status} status
 * @param {Date} at
 */
const thisNode = (status, at) => {
  const hubName =
    status.hubNodeId === null
      ? null
      : (status.nodes.find((node) => node.nodeId === status.hubNodeId)?.name ??
        null);
  let hub = 'none elected';
  if (status.role === 'hub') {
    hub = `this node (${status.hubAddress ?? ''})`.replace(' ()', '');
  } else if (status.hubAddress !== null) {
    hub =
      hubName === null
        ? status.hubAddress
        : `${hubName} (${status.hubAddress})`;
  }
  return facts([
    ['Name', status.nodeName],
    ['Role', roleBadge(status.role)],
    ['Node id', nodeIdCode(status.nodeId)],
    ['Identity', identitySummary(status.identity)],
    ['Domain', status.domain],
    ['Hub', hub],
    ['Peers', String(status.peers.length)],
    ['Transport', transportSummary(status.transport)],
    ['Updated', timeFormat.format(at)],
  ]);
};

/**
 * @param {import('../status-feed.js').StatusNode} node
 * @param {boolean | undefined} reachableFromBrowser
 * @param {Date} at
 */
const nodeCard = (node, reachableFromBrowser, at) => {
  const heading = element('h3', 'node-card-name');
  if (node.self) {
    heading.append(
      element('span', '', node.name ?? node.url),
      element('span', 'node-card-self', ' (this node)'),
    );
  } else {
    const link = element('a', '', nodeLabel(node));
    link.href = node.url;
    heading.append(link, transferIcons(node));
  }

  const signals = element('ul', 'node-signals');
  signals.setAttribute('role', 'list');
  signals.append(
    signal(
      topologyDot(node.seenInTopology),
      node.seenInTopology
        ? 'In the discovery topology'
        : 'Not in the discovery topology',
    ),
    signal(
      probeMarker(node.reachable),
      node.reachable
        ? "Reachable by this node's probe"
        : "Not reachable by this node's probe",
    ),
  );
  if (!node.self) {
    let text = 'Browser probe pending';
    if (reachableFromBrowser === true) {
      text = 'Reachable from your browser';
    } else if (reachableFromBrowser === false) {
      text = 'Not reachable from your browser';
    }
    signals.append(signal(browserProbeMarker(reachableFromBrowser), text));
  }

  const meta = element('p', 'node-card-meta');
  meta.append(
    roleBadge(node.role),
    ...[
      connectedClientsBadge(node.connectedClients),
      identityBadge(node.identity),
    ].filter((badge) => badge !== null),
    element('span', 'node-card-url', node.url),
    nodeIdCode(node.nodeId),
  );
  const seen = element(
    'p',
    'node-card-seen',
    node.lastSeen === null
      ? 'Never seen by this node'
      : `Last seen ${formatRelativeTime(node.lastSeen, at)}`,
  );

  const card = element('li', 'card node-card');
  card.append(heading, meta, signals, seen);
  if (!node.self) {
    const transfers = element(
      'button',
      'button button-secondary node-card-transfers',
      'Transfers',
    );
    transfers.type = 'button';
    transfers.dataset.transferPartner = node.url;
    transfers.setAttribute('aria-label', `Transfers with ${nodeLabel(node)}`);
    transfers.addEventListener('click', () => openTransfersOf(node, transfers));
    card.append(transfers);
  }
  return card;
};

/**
 * The display name of a node by its id: from the environment's node list
 * or the discovered peers, the first characters of the id when neither
 * knows it.
 *
 * @param {import('../status-feed.js').Status} status
 * @param {string} nodeId
 */
const nodeNameOf = (status, nodeId) =>
  status.nodes.find((node) => node.nodeId === nodeId)?.name ??
  status.peers.find((peer) => peer.nodeId === nodeId)?.name ??
  nodeId.slice(0, 8);

/**
 * Where a transfer came from or went to, as a phrase: "from node2",
 * "to node1", "to every client" for a hub's announcement, "from the hub"
 * for an announcement that named no writer.
 *
 * @param {import('../status-feed.js').Status} status
 * @param {import('../status-feed.js').SyncTransfer} transfer
 */
const transferPartner = (status, transfer) => {
  const preposition = transfer.direction === 'incoming' ? 'from' : 'to';
  if (transfer.peerNodeId !== null) {
    return `${preposition} ${nodeNameOf(status, transfer.peerNodeId)}`;
  }
  return transfer.direction === 'incoming' ? 'from the hub' : 'to every client';
};

/**
 * The rows a transfer named, as "4 rows in 4 tables", with the tables in
 * the title.
 *
 * @param {Record<string, number>} tables
 */
const transferRows = (tables) => {
  const entries = Object.entries(tables);
  const rowCount = entries.reduce((sum, [, count]) => sum + count, 0);
  const text = element(
    'span',
    'transfer-rows',
    `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} in ${entries.length} ${entries.length === 1 ? 'table' : 'tables'}`,
  );
  text.title = entries.map(([table, count]) => `${table}: ${count}`).join(', ');
  return text;
};

/**
 * One transfer as a list item: direction and partner, the change set by
 * id and short hash, the rows, the outcome and when it finished.
 *
 * @param {import('../status-feed.js').Status} status
 * @param {import('../status-feed.js').SyncTransfer} transfer
 * @param {Date} at
 */
const transferItem = (status, transfer, at) => {
  const item = element('li', `transfer transfer-${transfer.direction}`);
  const heading = element('p', 'transfer-heading');
  heading.append(
    element(
      'span',
      'transfer-direction',
      transfer.direction === 'incoming' ? 'Received' : 'Announced',
    ),
    element(
      'span',
      'transfer-partner',
      ` ${transferPartner(status, transfer)}`,
    ),
    element(
      'span',
      `transfer-status transfer-status-${transfer.status}`,
      transfer.status,
    ),
  );
  const changeSet = element('p', 'transfer-change-set');
  changeSet.append(
    element(
      'span',
      'transfer-change-set-id',
      transfer.changeSetId ?? 'change set',
    ),
    element('code', 'transfer-hash', transfer.changeSetHash.slice(0, 8)),
  );
  changeSet.title = transfer.changeSetHash;
  const duration =
    transfer.direction === 'incoming' ? `, ${transfer.durationMs} ms` : '';
  const meta = element('p', 'transfer-meta');
  meta.append(
    transferRows(transfer.tables),
    element(
      'span',
      'transfer-time',
      `${formatRelativeTime(transfer.at, at)}${duration}`,
    ),
  );
  item.append(heading, changeSet, meta);
  if (transfer.error !== undefined) {
    item.append(element('p', 'transfer-error', transfer.error));
  }
  return item;
};

/**
 * The synchronisation section: the counters of this node's sync agent
 * and its last transfers, newest first.
 *
 * @param {import('../status-feed.js').Status} status
 * @param {Date} at
 */
const synchronisation = (status, at) => {
  const { sync } = status;
  const container = element('div', 'sync');
  container.append(
    facts([
      ['Announced', String(sync.announced)],
      ['Received', String(sync.received)],
      ['Skipped', `${sync.skipped} already held`],
      ['Pending', String(sync.pending)],
      ['Failed', String(sync.failed)],
      ['Last error', sync.lastError ?? 'none'],
    ]),
  );
  if (sync.transfers.length === 0) {
    container.append(statusMessage('No change sets transferred yet.'));
  } else {
    const list = element('ul', 'transfer-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Last transfers');
    list.append(
      ...sync.transfers.map((transfer) => transferItem(status, transfer, at)),
    );
    container.append(list);
  }
  return container;
};

/**
 * @param {import('../status-feed.js').StatusPeer} peer
 * @param {Date} at
 */
const peerCard = (peer, at) => {
  const card = element('li', 'card peer-card');
  const heading = element('h3', 'node-card-name', peer.name ?? peer.hostname);
  let probe = 'not probed yet';
  if (peer.probe !== null) {
    probe = peer.probe.reachable
      ? `reachable, ${peer.probe.latencyMs} ms`
      : 'not reachable';
  }
  card.append(
    heading,
    facts([
      ['Role', roleBadge(peer.role)],
      ['Node id', nodeIdCode(peer.nodeId)],
      ['Address', `${peer.addresses.join(', ')}:${peer.port}`],
      ['Probe', probe],
      ['Started', formatRelativeTime(peer.startedAt, at)],
      ['First seen', formatRelativeTime(peer.firstSeen, at)],
      ['Last seen', formatRelativeTime(peer.lastSeen, at)],
      [
        'Election',
        peer.excludedFromElection
          ? 'excluded by this node (it restarted or denies the hub role)'
          : 'candidate',
      ],
    ]),
  );
  return card;
};

/**
 * The network view: what this node is (name, role, id, domain, hub, what
 * its hub transport is doing), every node of the environment with the
 * discovery flag, the server-side probe, this browser's own probe, the
 * connected clients of the hub and, for a partner, the transfer icons
 * of the header and a button for the same transfer popup, the change set
 * synchronisation (counters and the last transfers, each with the node
 * it came from or went to), and the peers discovery knows with their
 * addresses and probe results. Follows the shared status feed, which the
 * stream's events refresh and which polls `/status` every thirty seconds
 * as the fallback while the view is open.
 */
class NetworkView extends HTMLElement {
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {(() => void) | null} */
  #unsubscribeActivity = null;

  connectedCallback() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading the network…'));
    this.#unsubscribe = statusFeed.subscribe((update) => this.#render(update));
    this.#unsubscribeActivity = transferActivity.subscribe(() =>
      applyActivityTo(this),
    );
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unsubscribeActivity?.();
    this.#unsubscribeActivity = null;
  }

  /**
   * @param {import('../status-feed.js').StatusUpdate} update
   */
  #render(update) {
    this.removeAttribute('aria-busy');
    if (update.status === null) {
      this.replaceChildren(
        viewTitle(),
        errorState(
          'Could not load the network status.',
          update.error,
          () => void statusFeed.refresh(),
        ),
      );
      return;
    }

    const { status, browserProbes, at } = update;
    const nodes = element('ul', 'card-list');
    nodes.setAttribute('role', 'list');
    nodes.append(
      ...status.nodes.map((node) =>
        nodeCard(node, browserProbes.get(node.url), at),
      ),
    );

    let peers;
    if (status.peers.length === 0) {
      peers = statusMessage('No peers discovered yet.');
    } else {
      peers = element('ul', 'card-list');
      peers.setAttribute('role', 'list');
      peers.append(...status.peers.map((peer) => peerCard(peer, at)));
    }

    this.replaceChildren(
      viewTitle(),
      section('This node', thisNode(status, at)),
      section('Nodes of the environment', nodes),
      section('Synchronisation', synchronisation(status, at)),
      section('Discovered peers', peers),
    );
    applyActivityTo(this);
  }
}

customElements.define('network-view', NetworkView);
