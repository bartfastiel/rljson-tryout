// @ts-check
import { element } from '../dom.js';
import {
  browserProbeMarker,
  connectedClientsBadge,
  nodeLabel,
  openTransfersOf,
  transferIcons,
} from '../node-indicators.js';
import { statusFeed } from '../status-feed.js';
import { transferActivity } from '../transfer-activity.js';
import { applyActivityTo } from '../transfer-icon.js';

/**
 * The header's node bar: this node as a light active badge, every other
 * node of the environment as a compact badge outlined green when
 * discovery on this node sees it and red otherwise, each with a small
 * secondary marker for this browser's own probe, a small count of
 * connected clients on the node that is the hub, and an upstream and a
 * downstream icon that animate while a change set is arriving from or
 * going to that node. Tapping a partner's badge opens the popup with the
 * last transfers with it (`transfer-dialog`); the popup carries the
 * node's link. Refreshed with every status poll, so the outlines follow
 * the topology while the page is open. With a single node only the
 * badge shows; when `/status` cannot be read the badge says so.
 */
class NodeBar extends HTMLElement {
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {(() => void) | null} */
  #unsubscribeActivity = null;

  connectedCallback() {
    this.setAttribute('role', 'navigation');
    this.setAttribute('aria-label', 'Nodes');
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
    if (update.status === null) {
      this.replaceChildren(this.#badge('unknown node', null));
      return;
    }

    const { status, browserProbes } = update;
    const children = [
      this.#badge(
        status.nodeName,
        status.transport.role === 'hub'
          ? (status.transport.connectedClients ?? 0)
          : null,
      ),
    ];
    for (const node of status.nodes) {
      if (node.self) {
        continue;
      }
      const partner = element(
        'button',
        `node-partner ${node.seenInTopology ? 'node-partner-seen' : 'node-partner-unseen'}`,
      );
      partner.type = 'button';
      partner.dataset.transferPartner = node.url;
      partner.append(
        element('span', 'node-partner-name', nodeLabel(node)),
        element(
          'span',
          'visually-hidden',
          node.seenInTopology
            ? ', in the discovery topology'
            : ', not in the discovery topology',
        ),
        ...[connectedClientsBadge(node.connectedClients)].filter(
          (badge) => badge !== null,
        ),
        browserProbeMarker(browserProbes.get(node.url)),
        transferIcons(node),
        element('span', 'visually-hidden', ', show transfers'),
      );
      partner.addEventListener('click', () => openTransfersOf(node, partner));
      children.push(partner);
    }
    this.replaceChildren(...children);
    applyActivityTo(this);
  }

  /**
   * @param {string} name
   * @param {number | null} connectedClients
   */
  #badge(name, connectedClients) {
    const badge = element('span', 'node-badge node-badge-active');
    badge.setAttribute('aria-current', 'true');
    badge.append(
      element('span', 'visually-hidden', 'Connected to node '),
      element('span', 'node-badge-name', name),
      ...[connectedClientsBadge(connectedClients)].filter(
        (clients) => clients !== null,
      ),
    );
    return badge;
  }
}

customElements.define('node-bar', NodeBar);
