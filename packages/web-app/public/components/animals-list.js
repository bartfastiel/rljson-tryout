// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import { hashQuery } from '../hash-route.js';

/**
 * One animal as `GET /api/animals` returns it, with its species already
 * joined in.
 *
 * @typedef {object} Animal
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string} speciesId
 * @property {string} speciesName
 * @property {string} bornOn
 * @property {number} priceCents
 */

/**
 * The subset of `GET /api/species` the filter chips need.
 *
 * @typedef {object} FilterSpecies
 * @property {string} id
 * @property {string} name
 */

const viewTitle = () => element('h1', 'view-title', 'Animals');

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const priceFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'EUR',
});

/**
 * @param {string} text
 */
const statusMessage = (text) => {
  const message = element('p', 'status', text);
  message.setAttribute('role', 'status');
  return message;
};

/**
 * The species id the `species` hash query parameter selects, or `null` when
 * the filter shows every animal. The hash is the single source of truth for
 * the filter, which is what makes `#/animals?species=duck` shareable.
 *
 * @returns {string | null}
 */
const selectedSpeciesId = () => hashQuery(location.hash).get('species');

/**
 * A horizontal row of tappable filter chips: one "All" chip plus one per
 * species, each a link into the hash query so the selection is a normal
 * navigation and stays shareable.
 *
 * @param {FilterSpecies[]} species
 */
const speciesFilter = (species) => {
  const selected = selectedSpeciesId();

  const allChip = element('a', 'chip', 'All');
  allChip.href = '#/animals';
  if (selected === null) {
    allChip.setAttribute('aria-current', 'page');
  }

  const chips = species.map((entry) => {
    const chip = element('a', 'chip', entry.name);
    chip.href = `#/animals?species=${encodeURIComponent(entry.id)}`;
    if (selected === entry.id) {
      chip.setAttribute('aria-current', 'page');
    }
    return chip;
  });

  const nav = element('nav', 'species-filter');
  nav.setAttribute('aria-label', 'Filter by species');
  nav.append(allChip, ...chips);
  return nav;
};

/**
 * @param {Animal} animal
 */
const animalCard = (animal) => {
  const meta = element('p', 'animal-meta');
  meta.append(
    element('span', 'animal-species', animal.speciesName),
    element(
      'span',
      'animal-born-on',
      `Born ${dateFormat.format(new Date(animal.bornOn))}`,
    ),
  );

  const card = element('article', 'card animal-card');
  card.append(
    element('h2', 'animal-name', animal.name),
    meta,
    element('p', 'animal-price', priceFormat.format(animal.priceCents / 100)),
  );

  const item = element('li', 'card-list-item');
  item.append(card);
  return item;
};

/**
 * @param {Animal[]} animals
 */
const animalCards = (animals) => {
  if (animals.length === 0) {
    return statusMessage('No animals match this filter.');
  }
  const list = element('ul', 'card-list');
  list.setAttribute('role', 'list');
  list.append(...animals.map(animalCard));
  return list;
};

/**
 * Lists the animals of this node as cards, with a species filter above
 * them. Fetches `/api/species` for the filter chips and `/api/animals`,
 * narrowed to the species the hash query selects, when it enters the
 * document; a hash change replaces this element with a fresh instance (see
 * `app.js`), which re-reads the query and refetches. Shows a loading, an
 * empty or an error state with a retry button until both lists are there.
 */
class AnimalsList extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewTitle(), statusMessage('Loading animals…'));
    try {
      const speciesId = selectedSpeciesId();
      const animalsPath =
        speciesId === null
          ? '/api/animals'
          : `/api/animals?species=${encodeURIComponent(speciesId)}`;
      const [species, animals] = await Promise.all([
        /** @type {Promise<FilterSpecies[]>} */ (fetchJson('/api/species')),
        /** @type {Promise<Animal[]>} */ (fetchJson(animalsPath)),
      ]);
      this.replaceChildren(
        viewTitle(),
        speciesFilter(species),
        animalCards(animals),
      );
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
      element('p', 'status-headline', 'Could not load the animals.'),
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

customElements.define('animals-list', AnimalsList);
