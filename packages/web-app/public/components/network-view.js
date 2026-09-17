// @ts-check
import { element } from '../dom.js';
import { browserProbeMarker, topologyDot } from '../node-indicators.js';
import { statusFeed } from '../status-feed.js';
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
    ['Domain', status.domain],
    ['Hub', hub],
    ['Peers', String(status.peers.length)],
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
    const link = element('a', '', node.name ?? new URL(node.url).host);
    link.href = node.url;
    heading.append(link);
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
  return card;
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
    ]),
  );
  return card;
};

/**
 * The network view: what this node is (name, role, id, domain, hub), every
 * node of the environment with the discovery flag, the server-side probe
 * and this browser's own probe, and the peers discovery knows with their
 * addresses and probe results. Follows the shared status feed, which
 * polls `/status` every five seconds while the view is open.
 */
class NetworkView extends HTMLElement {
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  connectedCallback() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading the network…'));
    this.#unsubscribe = statusFeed.subscribe((update) => this.#render(update));
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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
      section('Discovered peers', peers),
    );
  }
}

customElements.define('network-view', NetworkView);
