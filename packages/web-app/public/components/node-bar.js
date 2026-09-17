// @ts-check
import { element } from '../dom.js';
import { browserProbeMarker } from '../node-indicators.js';
import { statusFeed } from '../status-feed.js';

/**
 * @param {import('../status-feed.js').StatusNode} node
 */
const nodeLabel = (node) => node.name ?? new URL(node.url).host;

/**
 * The header's node bar: this node as a light active badge, every other
 * node of the environment as a compact link outlined green when discovery
 * on this node sees it and red otherwise, each with a small secondary
 * marker for this browser's own probe. Refreshed with every status poll,
 * so the outlines follow the topology while the page is open. With a
 * single node only the badge shows; when `/status` cannot be read the
 * badge says so.
 */
class NodeBar extends HTMLElement {
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  connectedCallback() {
    this.setAttribute('role', 'navigation');
    this.setAttribute('aria-label', 'Nodes');
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
    if (update.status === null) {
      this.replaceChildren(this.#badge('unknown node'));
      return;
    }

    const { status, browserProbes } = update;
    const children = [this.#badge(status.nodeName)];
    for (const node of status.nodes) {
      if (node.self) {
        continue;
      }
      const link = element(
        'a',
        `node-link ${node.seenInTopology ? 'node-link-seen' : 'node-link-unseen'}`,
      );
      link.href = node.url;
      link.append(
        element('span', 'node-link-name', nodeLabel(node)),
        element(
          'span',
          'visually-hidden',
          node.seenInTopology
            ? ', in the discovery topology'
            : ', not in the discovery topology',
        ),
        browserProbeMarker(browserProbes.get(node.url)),
      );
      children.push(link);
    }
    this.replaceChildren(...children);
  }

  /**
   * @param {string} name
   */
  #badge(name) {
    const badge = element('span', 'node-badge node-badge-active');
    badge.setAttribute('aria-current', 'true');
    badge.append(
      element('span', 'visually-hidden', 'Connected to node '),
      element('span', 'node-badge-name', name),
    );
    return badge;
  }
}

customElements.define('node-bar', NodeBar);
