// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import { hashQuery, hrefWithParams } from '../hash-route.js';
import { refreshOnChange } from '../live-events.js';
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
 * One page of animals as `GET /api/animals` returns it: the rows of the
 * requested slice and how many rows the filter matches in total.
 *
 * @typedef {object} AnimalPage
 * @property {Animal[]} items
 * @property {number} total
 * @property {number} limit
 * @property {number} offset
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

/**
 * The species, breeder, trait and search text the hash query selects,
 * `null` for a parameter that is absent. The hash is the single source of
 * truth for every one of them, which is what makes
 * `#/animals?species=duck&breeder=<id>&trait=<id>&q=quack` shareable,
 * restorable and what "back" from a detail returns to.
 *
 * @typedef {object} Selection
 * @property {string | null} speciesId
 * @property {string | null} breederId
 * @property {string | null} traitId
 * @property {string | null} query
 */

/**
 * How many animals one page holds, the node's default page size, and how
 * long the search field waits after the last keystroke before it asks the
 * node, long enough to skip the intermediate letters of a word typed at a
 * normal pace and short enough not to feel like a delay.
 */
const pageSize = 50;
const searchDebounceMilliseconds = 300;

/**
 * The tables the filter chips read from, and those the cards read from
 * on top of them; a change set naming one of the latter refreshes the
 * cards, one naming one of the former the chips as well.
 */
const filterTables = ['species', 'traits', 'breeders', 'persons'];
const shownTables = [...filterTables, 'animals', 'animalTraits'];

const countFormat = new Intl.NumberFormat(undefined);

const viewTitle = () => element('h1', 'view-title', 'Animals');

/**
 * @returns {Selection}
 */
const selectionFromHash = () => {
  const query = hashQuery(location.hash);
  const search = query.get('q');
  return {
    speciesId: query.get('species'),
    breederId: query.get('breeder'),
    traitId: query.get('trait'),
    query: search === null || search.trim() === '' ? null : search,
  };
};

/**
 * The hash query parameters of a selection, omitting what is `null`, so
 * the fully unfiltered selection produces the bare `#/animals` hash. Shared
 * by every href this view builds and by the search field, so the four
 * parameters always combine the same way.
 *
 * @param {Selection} selection
 */
const selectionParams = ({ speciesId, breederId, traitId, query }) => {
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
  if (query !== null) {
    params.set('q', query);
  }
  return params;
};

/**
 * The `#/animals` or `#/animals/<id>` href for a selection.
 *
 * @param {Selection} selection
 * @param {string} [animalId]
 */
const animalsHref = (selection, animalId) =>
  hrefWithParams(
    animalId === undefined
      ? '#/animals'
      : `#/animals/${encodeURIComponent(animalId)}`,
    selectionParams(selection),
  );

/**
 * The `/api/animals` path for a selection and a page: the same parameter
 * names the hash uses, plus `limit` and `offset`.
 *
 * @param {Selection} selection
 * @param {number} offset
 */
const animalsApiPath = (selection, offset) => {
  const params = selectionParams(selection);
  params.set('limit', String(pageSize));
  params.set('offset', String(offset));
  return `/api/animals?${params.toString()}`;
};

/**
 * One labelled row of tappable filter chips: a visible group label, an
 * "All" chip and one chip per option, each a link into the hash query so
 * the selection is a normal navigation and stays shareable. The species and
 * trait rows share this builder; each passes its own hrefs so that
 * selecting a chip in one row keeps the other rows' selection and the
 * search text, per the "All resets each group" rule. The compact breeder
 * summary (`breederSummary`) reuses the same builder with exactly two chips
 * instead of one per breeder.
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
 * @param {Selection} selection
 */
const speciesFilter = (species, selection) =>
  chipFilterRow({
    groupLabel: 'Species',
    ariaLabel: 'Filter by species',
    chips: [
      {
        name: 'All',
        selected: selection.speciesId === null,
        href: animalsHref({ ...selection, speciesId: null }),
      },
      ...species.map((entry) => ({
        name: entry.name,
        selected: selection.speciesId === entry.id,
        href: animalsHref({ ...selection, speciesId: entry.id }),
      })),
    ],
  });

/**
 * @param {FilterTrait[]} traits
 * @param {Selection} selection
 */
const traitFilter = (traits, selection) =>
  chipFilterRow({
    groupLabel: 'Traits',
    ariaLabel: 'Filter by traits',
    chips: [
      {
        name: 'All',
        selected: selection.traitId === null,
        href: animalsHref({ ...selection, traitId: null }),
      },
      ...traits.map((entry) => ({
        name: entry.name,
        selected: selection.traitId === entry.id,
        href: animalsHref({ ...selection, traitId: entry.id }),
      })),
    ],
  });

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
 * @param {Selection} selection
 */
const breederSummary = (breeders, selection) => {
  if (selection.breederId === null) {
    return null;
  }
  const breeder = breeders.find((entry) => entry.id === selection.breederId);

  return chipFilterRow({
    groupLabel: 'Breeder',
    ariaLabel: 'Filter by breeder',
    chips: [
      {
        name: breeder?.farmName ?? selection.breederId,
        selected: true,
        href: animalsHref(selection),
      },
      {
        name: 'All',
        selected: false,
        href: animalsHref({ ...selection, breederId: null }),
      },
    ],
  });
};

/**
 * @param {FilterSpecies[]} species
 * @param {FilterTrait[]} traits
 * @param {FilterBreeder[]} breeders
 * @param {Selection} selection
 */
const animalFilters = (species, traits, breeders, selection) => {
  const container = element('div', 'animal-filters');
  const breederFilterSummary = breederSummary(breeders, selection);
  container.append(
    speciesFilter(species, selection),
    traitFilter(traits, selection),
    ...(breederFilterSummary === null ? [] : [breederFilterSummary]),
  );
  return container;
};

/**
 * @param {Animal} animal
 * @param {Selection} selection
 */
const animalCard = (animal, selection) => {
  const meta = element('p', 'animal-meta');
  meta.append(
    element('span', 'animal-species', animal.speciesName ?? 'Unknown species'),
    element(
      'span',
      'animal-born-on',
      `Born ${dateFormat.format(parseDateOnly(animal.bornOn))}`,
    ),
  );

  // The whole card is one link to the animal's detail page, carrying the
  // selection along so that the detail can link back to this very list;
  // a tap anywhere on it reaches the detail view with a single target.
  const card = element('a', 'card animal-card');
  card.href = animalsHref(selection, animal.id);
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
 * The search field at the top of the list, 44 pixels tall like every other
 * control, with a visually hidden label for screen readers and the
 * placeholder as the visible hint. `onSearch` runs with the trimmed text
 * once typing pauses for `searchDebounceMilliseconds`, and immediately
 * when the field is cleared or submitted with Enter.
 *
 * @param {string} initialValue
 * @param {(text: string) => void} onSearch
 */
const searchField = (initialValue, onSearch) => {
  const label = element('label', 'visually-hidden', 'Search animals');
  label.htmlFor = 'animal-search';

  const input = element('input', 'text-input search-input');
  input.type = 'search';
  input.id = 'animal-search';
  input.autocomplete = 'off';
  input.placeholder = 'Search by name or species';
  input.value = initialValue;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;
  let lastSearched = initialValue.trim();
  const search = () => {
    clearTimeout(pending);
    pending = undefined;
    const text = input.value.trim();
    if (text !== lastSearched) {
      lastSearched = text;
      onSearch(text);
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(pending);
    if (input.value.trim() === '') {
      search();
    } else {
      pending = setTimeout(search, searchDebounceMilliseconds);
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });

  const field = element('div', 'search-field');
  field.setAttribute('role', 'search');
  field.append(label, input);
  return field;
};

/**
 * The line above the cards that says how many of the matching animals are
 * on the page: "50 of 2,000 animals" (in the viewer's number format),
 * updated as pages are loaded.
 *
 * @param {number} shown
 * @param {number} total
 */
const countLine = (shown, total) => {
  const line = element(
    'p',
    'animal-count',
    `${countFormat.format(shown)} of ${countFormat.format(total)} animals`,
  );
  line.setAttribute('role', 'status');
  return line;
};

/**
 * The species, traits and breeders the filter chips are built from.
 */
const fetchFilterOptions = async () => {
  const [species, traits, breeders] = await Promise.all([
    /** @type {Promise<FilterSpecies[]>} */ (fetchJson('/api/species')),
    /** @type {Promise<FilterTrait[]>} */ (fetchJson('/api/traits')),
    /** @type {Promise<FilterBreeder[]>} */ (fetchJson('/api/breeders')),
  ]);
  return { species, traits, breeders };
};

/**
 * Lists the animals of this node as cards, with a search field, a species
 * filter, a trait filter and, while a breeder is selected, a compact
 * breeder filter summary above them, all reading from and writing to the
 * hash query so they combine and stay shareable
 * (`#/animals?species=duck&breeder=<id>&trait=<id>&q=quack`). Fetches
 * `/api/species`, `/api/traits` and `/api/breeders` for the filters and
 * the first page of `/api/animals`, narrowed to whatever the hash query
 * selects, when it enters the document; a "Load more" button appends the
 * next page while the node holds more matching animals than are shown.
 * Typing into the search field rewrites the hash's `q` without a
 * navigation (`history.replaceState`), so the field keeps its focus, and
 * reloads only the cards; a filter chip is a navigation that replaces
 * this element with a fresh instance (see `app.js`), which re-reads the
 * whole query, search text included. Shows a loading, an empty or an
 * error state with a retry button until the lists are there. From then
 * on the view follows the node's change sets: the cards of every page
 * loaded so far are fetched again and swapped in place, the chips too
 * when a species, trait or breeder changed, and the search text, the
 * selection, the "Load more" position and the scroll position stay.
 */
class AnimalsList extends HTMLElement {
  /** @type {Selection} */
  selection = selectionFromHash();

  /** @type {{ species: FilterSpecies[], traits: FilterTrait[], breeders: FilterBreeder[] }} */
  filterOptions = { species: [], traits: [], breeders: [] };

  /** @type {HTMLElement} */
  filters = element('div', 'animal-filters');

  /** @type {Animal[]} */
  loaded = [];

  total = 0;

  results = element('div', 'animal-results');

  /** @type {(() => void) | null} */
  #unsubscribe = null;

  connectedCallback() {
    void this.load();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.selection = selectionFromHash();
    this.replaceChildren(viewTitle(), statusMessage('Loading animals…'));
    try {
      const [filterOptions, page] = await Promise.all([
        fetchFilterOptions(),
        /** @type {Promise<AnimalPage>} */ (
          fetchJson(animalsApiPath(this.selection, 0))
        ),
      ]);
      this.filterOptions = filterOptions;
      this.filters = this.buildFilters();
      this.replaceChildren(
        viewTitle(),
        searchField(this.selection.query ?? '', (text) => this.search(text)),
        this.filters,
        this.results,
      );
      this.showPage(page, []);
      this.#unsubscribe ??= refreshOnChange(
        shownTables,
        (changed) => void this.refresh(changed),
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

  buildFilters() {
    const { species, traits, breeders } = this.filterOptions;
    return animalFilters(species, traits, breeders, this.selection);
  }

  /**
   * Brings the view up to date with the node after a change set: the
   * chips when a table they read from changed (`changed` is `null` after
   * a reconnection, when anything may have), and the cards of every page
   * loaded so far, fetched again page by page and swapped in place. What
   * came back is dropped when the selection moved on or a page was added
   * meanwhile, since the next change refreshes again; a failed refresh
   * keeps the cards that are there, at worst a moment old.
   *
   * @param {ReadonlySet<string> | null} changed
   */
  async refresh(changed) {
    const selection = this.selection;
    const loadedBefore = this.loaded.length;
    const pagesLoaded = Math.max(1, Math.ceil(loadedBefore / pageSize));
    const refreshFilters =
      changed === null || filterTables.some((table) => changed.has(table));
    /** @type {Awaited<ReturnType<typeof fetchFilterOptions>> | null} */
    let filterOptions;
    /** @type {AnimalPage[]} */
    let pages;
    try {
      [filterOptions, pages] = await Promise.all([
        refreshFilters ? fetchFilterOptions() : null,
        Promise.all(
          Array.from(
            { length: pagesLoaded },
            (_, page) =>
              /** @type {Promise<AnimalPage>} */ (
                fetchJson(animalsApiPath(selection, page * pageSize))
              ),
          ),
        ),
      ]);
    } catch {
      return;
    }
    if (
      selection !== this.selection ||
      this.loaded.length !== loadedBefore ||
      !this.results.isConnected
    ) {
      return;
    }
    if (filterOptions !== null) {
      this.filterOptions = filterOptions;
      const filters = this.buildFilters();
      this.filters.replaceWith(filters);
      this.filters = filters;
    }
    const last = pages[pages.length - 1];
    this.showPage(
      {
        items: pages.flatMap((page) => page.items),
        total: last?.total ?? 0,
        limit: pageSize,
        offset: 0,
      },
      [],
    );
  }

  /**
   * Applies a new search text: writes it into the hash without a
   * navigation, rebuilds the filter chips so their hrefs carry the text,
   * and reloads the cards from the first page.
   *
   * @param {string} text
   */
  search(text) {
    this.selection = { ...this.selection, query: text === '' ? null : text };
    history.replaceState(null, '', animalsHref(this.selection));
    const filters = this.buildFilters();
    this.filters.replaceWith(filters);
    this.filters = filters;
    void this.loadPage(0);
  }

  /**
   * Fetches one page of the current selection and shows it: the first page
   * replaces the cards, a later page appends to them.
   *
   * @param {number} offset
   */
  async loadPage(offset) {
    const selection = this.selection;
    this.results.setAttribute('aria-busy', 'true');
    if (offset === 0) {
      this.results.replaceChildren(statusMessage('Loading animals…'));
    }
    try {
      const page = /** @type {AnimalPage} */ (
        await fetchJson(animalsApiPath(selection, offset))
      );
      if (selection !== this.selection) {
        return;
      }
      this.showPage(page, offset === 0 ? [] : this.loaded);
    } catch (error) {
      if (selection !== this.selection) {
        return;
      }
      this.results.replaceChildren(
        errorState(
          'Could not load the animals.',
          error,
          () => void this.loadPage(offset),
        ),
      );
    } finally {
      this.results.removeAttribute('aria-busy');
    }
  }

  /**
   * Renders the cards of the animals loaded so far plus the new page, the
   * count line and, while more remain, the "Load more" button.
   *
   * @param {AnimalPage} page
   * @param {Animal[]} before
   */
  showPage(page, before) {
    this.loaded = [...before, ...page.items];
    this.total = page.total;
    if (this.loaded.length === 0) {
      this.results.replaceChildren(
        statusMessage('No animals match this filter.'),
      );
      return;
    }
    const list = element('ul', 'card-list');
    list.setAttribute('role', 'list');
    list.append(
      ...this.loaded.map((animal) => animalCard(animal, this.selection)),
    );
    /** @type {HTMLElement[]} */
    const children = [countLine(this.loaded.length, this.total), list];
    if (this.loaded.length < this.total) {
      const more = element('button', 'button button-secondary load-more');
      more.type = 'button';
      more.textContent = 'Load more';
      more.addEventListener('click', () => {
        more.disabled = true;
        void this.loadPage(this.loaded.length);
      });
      children.push(more);
    }
    this.results.replaceChildren(...children);
  }
}

customElements.define('animals-list', AnimalsList);
