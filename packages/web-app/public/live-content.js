// @ts-check
import { refreshOnChange } from './live-events.js';

/**
 * The part of a view that follows the node's live events: an element
 * built from a fetch (the cards of a list, the body of a detail) that is
 * swapped for a fresh one whenever a change set touches one of the given
 * tables, in place, so that the rest of the view, the focus and the
 * scroll position stay as they are. `show` runs the first fetch and
 * subscribes; the view puts the element it returns on screen and calls
 * `stop` when it leaves the document. A refresh that fails keeps what is
 * on screen, at worst a moment old; the error state with its Retry button
 * belongs to the initial load, whose failure `show` rejects with.
 */
export class LiveContent {
  /** @type {readonly string[]} */
  #tables;
  /** @type {() => Promise<HTMLElement>} */
  #build;
  /** @type {HTMLElement | null} */
  #current = null;
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  /**
   * @param {readonly string[]} tables the tables the content reads from
   * @param {() => Promise<HTMLElement>} build fetches and builds the content
   */
  constructor(tables, build) {
    this.#tables = tables;
    this.#build = build;
  }

  /**
   * Builds the content and, once that succeeded, follows the node's
   * changes to keep it current. Returns the element to show.
   */
  async show() {
    this.#current = await this.#build();
    this.#unsubscribe ??= refreshOnChange(
      this.#tables,
      () => void this.#refresh(),
    );
    return this.#current;
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #refresh() {
    let next;
    try {
      next = await this.#build();
    } catch {
      return;
    }
    if (this.#current?.isConnected) {
      this.#current.replaceWith(next);
      this.#current = next;
    }
  }
}
