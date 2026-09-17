// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';

/**
 * One species as `GET /api/species` returns it.
 *
 * @typedef {object} Species
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string} latinName
 * @property {string} description
 */

const viewTitle = () => element('h1', 'view-title', 'Species');

/**
 * @param {string} text
 */
const statusMessage = (text) => {
  const message = element('p', 'status', text);
  message.setAttribute('role', 'status');
  return message;
};

/**
 * @param {Species} species
 */
const speciesCard = (species) => {
  const latinName = element('i', '', species.latinName);
  latinName.lang = 'la';
  const latinNameLine = element('p', 'species-latin-name');
  latinNameLine.append(latinName);

  const animalsLink = element('a', 'button', 'See animals');
  animalsLink.href = `#/animals?species=${encodeURIComponent(species.id)}`;

  const card = element('article', 'card species-card');
  card.append(
    element('h2', 'species-name', species.name),
    latinNameLine,
    element('p', 'species-description', species.description),
    animalsLink,
  );

  const item = element('li', 'card-list-item');
  item.append(card);
  return item;
};

/**
 * @param {Species[]} species
 */
const speciesCards = (species) => {
  if (species.length === 0) {
    return statusMessage('No species yet.');
  }
  const list = element('ul', 'card-list');
  list.setAttribute('role', 'list');
  list.append(...species.map(speciesCard));
  return list;
};

/**
 * Lists the species of this node as cards. Fetches `/api/species` when it
 * enters the document and shows a loading, an empty or an error state with
 * a retry button until the list is there.
 */
class SpeciesList extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading species…'));
    try {
      const species = /** @type {Species[]} */ (
        await fetchJson('/api/species')
      );
      this.replaceChildren(viewTitle(), speciesCards(species));
    } catch (error) {
      this.replaceChildren(viewTitle(), this.errorState(error));
    } finally {
      this.removeAttribute('aria-busy');
    }
  }

  /**
   * @param {unknown} error
   */
  errorState(error) {
    const retry = element('button', 'button', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', () => void this.load());

    const state = element('div', 'status status-error');
    state.setAttribute('role', 'alert');
    state.append(
      element('p', 'status-headline', 'Could not load the species.'),
      element(
        'p',
        'status-detail',
        error instanceof Error ? error.message : String(error),
      ),
      retry,
    );
    return state;
  }
}

customElements.define('species-list', SpeciesList);
