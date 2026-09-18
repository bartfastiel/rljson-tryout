// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import { LiveContent } from '../live-content.js';
import { errorState, statusMessage } from '../view-helpers.js';

/**
 * One species as `GET /api/species` returns it.
 *
 * @typedef {object} Species
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string} latinName
 * @property {string} description
 * @property {string} imageUrl
 */

const viewTitle = () => element('h1', 'view-title', 'Species');

/**
 * The badge of a species at the top of its card. The intrinsic size and
 * the square aspect ratio reserve the space before the bytes arrive, so
 * the text below does not jump; the image loads lazily since a long list
 * of species scrolls past most of them.
 *
 * @param {Species} species
 */
const speciesImage = (species) => {
  const image = element('img', 'species-image');
  image.src = species.imageUrl;
  image.alt = species.name;
  image.width = 256;
  image.height = 256;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
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
    speciesImage(species),
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
 * a retry button until the list is there; from then on the cards follow
 * every change set of the node that touches the species.
 */
class SpeciesList extends HTMLElement {
  #cards = new LiveContent(['species'], async () =>
    speciesCards(/** @type {Species[]} */ (await fetchJson('/api/species'))),
  );

  connectedCallback() {
    void this.load();
  }

  disconnectedCallback() {
    this.#cards.stop();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading species…'));
    try {
      this.replaceChildren(viewTitle(), await this.#cards.show());
    } catch (error) {
      this.replaceChildren(
        viewTitle(),
        errorState(
          'Could not load the species.',
          error,
          () => void this.load(),
        ),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('species-list', SpeciesList);
