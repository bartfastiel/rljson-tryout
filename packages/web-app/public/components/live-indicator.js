// @ts-check
import { element } from '../dom.js';
import { liveEvents } from '../live-events.js';

/**
 * The words the indicator shows per state. Before the stream was ever
 * open the amber state reads "connecting" rather than "reconnecting",
 * since nothing was lost yet.
 *
 * @param {import('../live-events.js').LiveState} state
 */
const labelOf = (state) => {
  if (state === 'reconnecting' && !liveEvents.everLive) {
    return 'connecting';
  }
  return state;
};

/**
 * The header's connection indicator for the live updates: a dot that is
 * green while the event stream is open ("live"), amber while it is being
 * (re)opened ("reconnecting") and grey while the browser is offline
 * ("offline"), with the state as visible text and a visually hidden
 * prefix so that assistive technology reads "Live updates: live". A
 * polite live region, so that a change of state is announced without
 * interrupting; not a `status` role, which every view keeps for its own
 * loading and empty messages.
 */
class LiveIndicator extends HTMLElement {
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  connectedCallback() {
    this.setAttribute('aria-live', 'polite');
    this.#render(liveEvents.state);
    this.#unsubscribe = liveEvents.onState((state) => this.#render(state));
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /**
   * @param {import('../live-events.js').LiveState} state
   */
  #render(state) {
    const label = labelOf(state);
    this.className = `live-indicator live-indicator-${state}`;
    this.title = `Live updates: ${label}`;
    const dot = element('span', 'live-dot');
    dot.setAttribute('aria-hidden', 'true');
    this.replaceChildren(
      dot,
      element('span', 'visually-hidden', 'Live updates: '),
      element('span', 'live-label', label),
    );
  }
}

customElements.define('live-indicator', LiveIndicator);
