// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import { hashQuery } from '../hash-route.js';
import {
  dateFormat,
  errorState,
  parseDateOnly,
  priceFormat,
  statusMessage,
} from '../view-helpers.js';

/**
 * One animal as `GET /api/animals` returns it, with its species and breeder
 * already joined in. `speciesId`, `speciesName`, `breederId` and
 * `breederFarmName` are `null` for the unreachable case of a dangling
 * reference (see `PetShopStore.listAnimals`).
 *
 * @typedef {object} Animal
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string | null} speciesId
 * @property {string | null} speciesName
 * @property {string | null} breederId
 * @property {string | null} breederFarmName
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

/**
 * The subset of `GET /api/traits` the filter chips need.
 *
 * @typedef {object} FilterTrait
 * @property {string} id
 * @property {string} name
 */

/**
 * The subset of `GET /api/breeders` the breeder filter summary needs.
 *
 * @typedef {object} FilterBreeder
 * @property {string} id
 * @property {string} farmName
 */

const viewTitle = () => element('h1', 'view-title', 'Animals');

/**
 * The species id the `species` hash query parameter selects, or `null` when
 * the species filter shows every animal. The hash is the single source of
 * truth for every filter, which is what makes
 * `#/animals?species=duck&breeder=<id>&trait=<id>` shareable and
 * restorable.
 *
 * @returns {string | null}
 */
const selectedSpeciesId = () => hashQuery(location.hash).get('species');

/**
 * The breeder id the `breeder` hash query parameter selects, or `null` when
 * the breeder filter shows every animal.
 *
 * @returns {string | null}
 */
const selectedBreederId = () => hashQuery(location.hash).get('breeder');

/**
 * The trait id the `trait` hash query parameter selects, or `null` when the
 * trait filter shows every animal.
 *
 * @returns {string | null}
 */
const selectedTraitId = () => hashQuery(location.hash).get('trait');

/**
 * The `species`, `breeder` and `trait` query string for the given
 * selection, without a leading `?`, omitting a parameter that is `null`.
 * Shared by every href this view builds, so the three filters always
 * combine the same way.
 *
 * @param {string | null} speciesId
 * @param {string | null} breederId
 * @param {string | null} traitId
 */
const filterQueryParams = (speciesId, breederId, traitId) => {
  const params = new URLSearchParams();
  if (speciesId !== null) {
    params.set('species', speciesId);
  }
  if (breederId !== null) {
    params.set('breeder', breederId);
  }
  if (traitId !== null) {
    params.set('trait', traitId);
  }
  return params.toString();
};

/**
 * The `#/animals` or `#/animals/<id>` href for the given species, breeder
 * and trait selection. `null` omits that parameter, so the fully unfiltered
 * selection produces the bare `#/animals` hash.
 *
 * @param {{
 *   speciesId: string | null,
 *   breederId: string | null,
 *   traitId: string | null,
 *   animalId?: string,
 * }} selection
 */
const animalsHref = ({ speciesId, breederId, traitId, animalId }) => {
  const query = filterQueryParams(speciesId, breederId, traitId);
  const path =
    animalId === undefined
      ? '#/animals'
      : `#/animals/${encodeURIComponent(animalId)}`;
  return query === '' ? path : `${path}?${query}`;
};

/**
 * One labelled row of tappable filter chips: a visible group label, an
 * "All" chip and one chip per option, each a link into the hash query so
 * the selection is a normal navigation and stays shareable. The species and
 * trait rows share this builder; each passes its own hrefs so that
 * selecting a chip in one row keeps the other rows' selection, per the
 * "All resets each group" rule. The compact breeder summary
 * (`breederSummary`) reuses the same builder with exactly two chips instead
 * of one per breeder.
 *
 * @param {{
 *   groupLabel: string,
 *   ariaLabel: string,
 *   chips: { name: string, selected: boolean, href: string }[],
 * }} config
 */
const chipFilterRow = ({ groupLabel, ariaLabel, chips }) => {
  const nav = element('nav', 'chip-row');
  nav.setAttribute('aria-label', ariaLabel);
  nav.append(
    ...chips.map(({ name, selected, href }) => {
      const chip = element('a', 'chip', name);
      chip.href = href;
      if (selected) {
        chip.setAttribute('aria-current', 'page');
      }
      return chip;
    }),
  );

  const group = element('div', 'filter-group');
  group.append(element('p', 'filter-group-label', groupLabel), nav);
  return group;
};

/**
 * @param {FilterSpecies[]} species
 */
const speciesFilter = (species) => {
  const selectedSpecies = selectedSpeciesId();
  const breederId = selectedBreederId();
  const traitId = selectedTraitId();

  return chipFilterRow({
    groupLabel: 'Species',
    ariaLabel: 'Filter by species',
    chips: [
      {
        name: 'All',
        selected: selectedSpecies === null,
        href: animalsHref({ speciesId: null, breederId, traitId }),
      },
      ...species.map((entry) => ({
        name: entry.name,
        selected: selectedSpecies === entry.id,
        href: animalsHref({ speciesId: entry.id, breederId, traitId }),
      })),
    ],
  });
};

/**
 * @param {FilterTrait[]} traits
 */
const traitFilter = (traits) => {
  const speciesId = selectedSpeciesId();
  const breederId = selectedBreederId();
  const selectedTrait = selectedTraitId();

  return chipFilterRow({
    groupLabel: 'Traits',
    ariaLabel: 'Filter by traits',
    chips: [
      {
        name: 'All',
        selected: selectedTrait === null,
        href: animalsHref({ speciesId, breederId, traitId: null }),
      },
      ...traits.map((entry) => ({
        name: entry.name,
        selected: selectedTrait === entry.id,
        href: animalsHref({ speciesId, breederId, traitId: entry.id }),
      })),
    ],
  });
};

/**
 * The compact breeder filter summary: a single line with the active
 * breeder's farm name and an "All" reset, shown only while a breeder is
 * selected. A full chip row with one entry per breeder (the shape
 * `speciesFilter` and `traitFilter` use) would grow with the number of
 * breeders and risks crowding a 360px phone next to the other two filter
 * rows, so this view shows the breeder filter only as its active state
 * plus a way to clear it; picking a breeder happens from the breeders view
 * (`#/breeders`) instead, whose cards link here with `?breeder=<id>`.
 * `null` when no breeder is selected, so `animalFilters` can leave the row
 * out entirely.
 *
 * @param {FilterBreeder[]} breeders
 */
const breederSummary = (breeders) => {
  const breederId = selectedBreederId();
  if (breederId === null) {
    return null;
  }
  const speciesId = selectedSpeciesId();
  const traitId = selectedTraitId();
  const breeder = breeders.find((entry) => entry.id === breederId);

  return chipFilterRow({
    groupLabel: 'Breeder',
    ariaLabel: 'Filter by breeder',
    chips: [
      {
        name: breeder?.farmName ?? breederId,
        selected: true,
        href: animalsHref({ speciesId, breederId, traitId }),
      },
      {
        name: 'All',
        selected: false,
        href: animalsHref({ speciesId, breederId: null, traitId }),
      },
    ],
  });
};

/**
 * @param {FilterSpecies[]} species
 * @param {FilterTrait[]} traits
 * @param {FilterBreeder[]} breeders
 */
const animalFilters = (species, traits, breeders) => {
  const container = element('div', 'animal-filters');
  const breederFilterSummary = breederSummary(breeders);
  container.append(
    speciesFilter(species),
    traitFilter(traits),
    ...(breederFilterSummary === null ? [] : [breederFilterSummary]),
  );
  return container;
};

/**
 * The href of an animal's detail page, carrying the currently selected
 * species, breeder and trait filters along so that `animal-detail.js` can
 * send a "back" link to the filtered list the card was clicked from, not
 * the full list.
 *
 * @param {string} animalId
 */
const animalDetailHref = (animalId) =>
  animalsHref({
    speciesId: selectedSpeciesId(),
    breederId: selectedBreederId(),
    traitId: selectedTraitId(),
    animalId,
  });

/**
 * @param {Animal} animal
 */
const animalCard = (animal) => {
  const meta = element('p', 'animal-meta');
  meta.append(
    element('span', 'animal-species', animal.speciesName ?? 'Unknown species'),
    element(
      'span',
      'animal-born-on',
      `Born ${dateFormat.format(parseDateOnly(animal.bornOn))}`,
    ),
  );

  // The whole card is one link to the animal's detail page, so a tap
  // anywhere on it reaches the detail view with a single, large target.
  const card = element('a', 'card animal-card');
  card.href = animalDetailHref(animal.id);
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
 * Lists the animals of this node as cards, with a species filter, a trait
 * filter and, while a breeder is selected, a compact breeder filter summary
 * above them, all reading from and writing to the hash query so they
 * combine and stay shareable
 * (`#/animals?species=duck&breeder=<id>&trait=<id>`). Fetches
 * `/api/species`, `/api/traits` and `/api/breeders` for the filters and
 * `/api/animals`, narrowed to whatever the hash query selects, when it
 * enters the document; a hash change replaces this element with a fresh
 * instance (see `app.js`), which re-reads the query and refetches. Shows a
 * loading, an empty or an error state with a retry button until every list
 * is there.
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
      const breederId = selectedBreederId();
      const traitId = selectedTraitId();
      const query = filterQueryParams(speciesId, breederId, traitId);
      const animalsPath =
        query === '' ? '/api/animals' : `/api/animals?${query}`;
      const [species, traits, breeders, animals] = await Promise.all([
        /** @type {Promise<FilterSpecies[]>} */ (fetchJson('/api/species')),
        /** @type {Promise<FilterTrait[]>} */ (fetchJson('/api/traits')),
        /** @type {Promise<FilterBreeder[]>} */ (fetchJson('/api/breeders')),
        /** @type {Promise<Animal[]>} */ (fetchJson(animalsPath)),
      ]);
      this.replaceChildren(
        viewTitle(),
        animalFilters(species, traits, breeders),
        animalCards(animals),
      );
    } catch (error) {
      this.replaceChildren(
        viewTitle(),
        errorState(
          'Could not load the animals.',
          error,
          () => void this.load(),
        ),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('animals-list', AnimalsList);
