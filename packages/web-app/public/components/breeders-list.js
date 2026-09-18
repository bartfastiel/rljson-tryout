// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import { LiveContent } from '../live-content.js';
import {
  dateFormat,
  errorState,
  parseDateOnly,
  statusMessage,
} from '../view-helpers.js';

/**
 * The person behind a breeder, as `GET /api/breeders` joins it in. `null`
 * for the unreachable case of a dangling `personRef` (see
 * `PetShopStore.listBreeders`).
 *
 * @typedef {object} BreederPerson
 * @property {string} id
 * @property {string} name
 * @property {string} city
 */

/**
 * One breeder as `GET /api/breeders` returns it.
 *
 * @typedef {object} Breeder
 * @property {string} id
 * @property {string} hash
 * @property {string} farmName
 * @property {string} suppliesSince
 * @property {BreederPerson | null} person
 */

const viewTitle = () => element('h1', 'view-title', 'Breeders');

/**
 * @param {Breeder} breeder
 */
const breederCard = (breeder) => {
  const meta = element('p', 'breeder-meta');
  meta.append(
    element('span', 'breeder-person', breeder.person?.name ?? 'Unknown person'),
    element('span', 'breeder-city', breeder.person?.city ?? 'Unknown city'),
    element(
      'span',
      'breeder-supplies-since',
      `Supplying since ${dateFormat.format(parseDateOnly(breeder.suppliesSince))}`,
    ),
  );

  // The whole card is one link into the animals list filtered to this
  // breeder, so a tap anywhere on it reaches the filtered animals with a
  // single, large target, the same pattern `animals-list.js` uses for an
  // animal card.
  const card = element('a', 'card breeder-card');
  card.href = `#/animals?breeder=${encodeURIComponent(breeder.id)}`;
  card.append(element('h2', 'breeder-farm-name', breeder.farmName), meta);

  const item = element('li', 'card-list-item');
  item.append(card);
  return item;
};

/**
 * @param {Breeder[]} breeders
 */
const breederCards = (breeders) => {
  if (breeders.length === 0) {
    return statusMessage('No breeders yet.');
  }
  const list = element('ul', 'card-list');
  list.setAttribute('role', 'list');
  list.append(...breeders.map(breederCard));
  return list;
};

/**
 * Lists the breeders of this node as cards (farm name, supplying person's
 * name and city, supplies since), each linking to the animals list filtered
 * to that breeder (`#/animals?breeder=<id>`). Fetches `/api/breeders` when
 * it enters the document and shows a loading, an empty or an error state
 * with a retry button until the list is there; from then on the cards
 * follow every change set of the node that touches a breeder or a person.
 */
class BreedersList extends HTMLElement {
  #cards = new LiveContent(['breeders', 'persons'], async () =>
    breederCards(/** @type {Breeder[]} */ (await fetchJson('/api/breeders'))),
  );

  connectedCallback() {
    void this.load();
  }

  disconnectedCallback() {
    this.#cards.stop();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading breeders…'));
    try {
      this.replaceChildren(viewTitle(), await this.#cards.show());
    } catch (error) {
      this.replaceChildren(
        viewTitle(),
        errorState(
          'Could not load the breeders.',
          error,
          () => void this.load(),
        ),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('breeders-list', BreedersList);
