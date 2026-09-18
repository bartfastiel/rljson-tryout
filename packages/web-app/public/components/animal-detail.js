// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import {
  animalDetailHref,
  animalFilterParams,
  animalListHref,
  hashQuery,
  hrefWithParams,
} from '../hash-route.js';
import { LiveContent } from '../live-content.js';
import { notFoundView } from '../not-found-view.js';
import {
  applicationName,
  dateFormat,
  dateOfTimeId,
  dateTimeFormat,
  errorState,
  parseDateOnly,
  priceFormat,
  statusMessage,
} from '../view-helpers.js';

/**
 * One trait as `GET /api/animals/:id` lists it on `traits`: just enough to
 * show a chip and link back to the filtered list.
 *
 * @typedef {object} AnimalTrait
 * @property {string} id
 * @property {string} name
 */

/**
 * The breeder behind an animal, as `GET /api/animals/:id` joins it in.
 * `null` for the unreachable case of a dangling `breederRef` (see
 * `PetShopStore.getAnimal`).
 *
 * @typedef {object} AnimalBreeder
 * @property {string} id
 * @property {string} farmName
 * @property {string | null} personName
 * @property {string | null} city
 */

/**
 * One animal as `GET /api/animals/:id` returns it: the fields the detail
 * view needs, with its species and breeder joined, its traits resolved and
 * the full background story. `speciesId` and `speciesName` are `null` for
 * the unreachable case of a dangling `speciesRef` (see
 * `PetShopStore.getAnimal`).
 *
 * @typedef {object} AnimalDetail
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string | null} speciesId
 * @property {string | null} speciesName
 * @property {string | null} breederId
 * @property {string | null} breederFarmName
 * @property {string} bornOn
 * @property {number} priceCents
 * @property {string} backgroundStory
 * @property {AnimalTrait[]} traits
 * @property {AnimalBreeder | null} breeder
 */

/**
 * One version of an animal as `GET /api/animals/:id/history` lists it,
 * newest first: the fields the version list shows and the `current` flag
 * of the rule in roadmap section 2.6.
 *
 * @typedef {object} AnimalVersion
 * @property {string} hash
 * @property {string} timeId
 * @property {string[]} previous
 * @property {boolean} current
 * @property {string} name
 * @property {number} priceCents
 */

/**
 * The hash of the version this view shows, from `?version=<hash>`, or
 * `null` for the current version.
 */
const requestedVersion = () => hashQuery(location.hash).get('version');

/**
 * The href of the form that writes the next version, keeping the list
 * filter so that the form's own way back returns to the same list.
 *
 * @param {string} animalId
 */
const editHref = (animalId) =>
  hrefWithParams(
    `#/animals/${encodeURIComponent(animalId)}/edit`,
    animalFilterParams(location.hash),
  );

/**
 * @returns {HTMLAnchorElement}
 */
const backLink = () => {
  const link = element('a', 'back-link', '← Back to Animals');
  link.href = animalListHref();
  return link;
};

/**
 * Splits a background story into paragraphs on blank lines and renders one
 * `<p>` per paragraph through `textContent`, so a story never reaches the
 * page as markup, however long it is.
 *
 * @param {string} story
 */
const storyParagraphs = (story) => {
  const paragraphs = story
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');

  const container = element('div', 'animal-story');
  container.append(
    ...paragraphs.map((paragraph) => element('p', '', paragraph)),
  );
  return container;
};

/**
 * The compact facts block: species as a link to the filtered list, breeder
 * as a link to the breeders view, born date and price.
 *
 * @param {AnimalDetail} animal
 */
const factsBlock = (animal) => {
  const speciesLink = element('a', '', animal.speciesName ?? 'Unknown species');
  speciesLink.href =
    animal.speciesId === null
      ? '#/animals'
      : `#/animals?species=${encodeURIComponent(animal.speciesId)}`;
  const speciesValue = element('dd', '');
  speciesValue.append(speciesLink);

  const breederLink = element(
    'a',
    '',
    animal.breeder?.farmName ?? 'Unknown breeder',
  );
  breederLink.href = '#/breeders';
  const breederValue = element('dd', '');
  breederValue.append(breederLink);

  const facts = element('dl', 'animal-facts');
  facts.append(
    element('dt', '', 'Species'),
    speciesValue,
    element('dt', '', 'Breeder'),
    breederValue,
    element('dt', '', 'Born'),
    element('dd', '', dateFormat.format(parseDateOnly(animal.bornOn))),
    element('dt', '', 'Price'),
    element('dd', '', priceFormat.format(animal.priceCents / 100)),
  );
  return facts;
};

/**
 * The animal's traits as a row of chips, each linking to the animals list
 * filtered to that one trait (`#/animals?trait=<id>`) rather than combining
 * with whatever filter this detail happened to be opened from, so tapping a
 * trait always shows every animal that shares it. `null` when the animal
 * carries no trait, so `detailView` can leave the section out entirely.
 *
 * @param {AnimalDetail} animal
 */
const traitChips = (animal) => {
  if (animal.traits.length === 0) {
    return null;
  }

  const list = element('ul', 'animal-traits');
  list.setAttribute('aria-label', 'Traits');
  list.append(
    ...animal.traits.map((trait) => {
      const chip = element('a', 'chip', trait.name);
      chip.href = `#/animals?trait=${encodeURIComponent(trait.id)}`;
      const item = element('li', '');
      item.append(chip);
      return item;
    }),
  );
  return list;
};

/**
 * The heading row: the animal's name and, on the newest current version,
 * the "Edit" action that opens the form writing the next version. Any
 * other version is read-only, so it gets no action.
 *
 * @param {AnimalDetail} animal
 * @param {boolean} isNewestTip
 */
const headingRow = (animal, isNewestTip) => {
  const header = element('div', 'view-header');
  header.append(element('h1', 'view-title', animal.name));
  if (isNewestTip) {
    const edit = element('a', 'button', 'Edit');
    edit.href = editHref(animal.id);
    header.append(edit);
  }
  return header;
};

/**
 * The notice above an old version: when it was written, and a link to the
 * current version. The moment comes from the version's `timeId`, and a
 * version is looked up by hash in the history, newest first, since an edit
 * that restores earlier content gives the same hash a second, newer
 * history entry.
 *
 * @param {AnimalDetail} animal
 * @param {AnimalVersion[]} history
 */
const oldVersionNotice = (animal, history) => {
  const version = history.find((entry) => entry.hash === animal.hash);
  const notice = element('p', 'version-notice');
  notice.setAttribute('role', 'status');
  const currentLink = element('a', '', 'Show the current version');
  currentLink.href = animalDetailHref(animal.id, null);
  notice.append(
    version === undefined
      ? 'You are viewing an older version. '
      : `You are viewing the version from ${dateTimeFormat.format(dateOfTimeId(version.timeId))}. `,
    currentLink,
  );
  return notice;
};

/**
 * One row of the version list: the moment the version was written, its
 * name when it differs from the version shown, its price, and a "current"
 * badge on every tip. The whole row is a link that shows that version: the
 * plain detail for the newest tip, `?version=<hash>` for every other
 * version, an older tip of an open branch included, so that each row opens
 * its own version; the row of the version on screen is marked as the
 * current page.
 *
 * @param {AnimalVersion} version
 * @param {AnimalDetail} shown
 * @param {string | undefined} newestTipHash
 */
const versionRow = (version, shown, newestTipHash) => {
  const link = element('a', 'version-link');
  link.href = animalDetailHref(
    shown.id,
    version.hash === newestTipHash ? null : version.hash,
  );
  if (version.hash === shown.hash) {
    link.setAttribute('aria-current', 'page');
  }
  const text = element('div', 'version-text');
  text.append(
    element(
      'span',
      'version-time',
      dateTimeFormat.format(dateOfTimeId(version.timeId)),
    ),
    element(
      'span',
      'version-summary',
      version.name === shown.name
        ? priceFormat.format(version.priceCents / 100)
        : `${version.name} · ${priceFormat.format(version.priceCents / 100)}`,
    ),
  );
  link.append(text);
  if (version.current) {
    link.append(element('span', 'version-badge', 'current'));
  }
  const item = element('li', 'version-item');
  item.append(link);
  return item;
};

/**
 * The "Versions" section: every version of the animal, newest first.
 *
 * @param {AnimalVersion[]} history
 * @param {AnimalDetail} shown
 * @param {string | undefined} newestTipHash
 */
const versionsSection = (history, shown, newestTipHash) => {
  const title = element('h2', 'section-title', 'Versions');
  title.id = 'animal-versions-title';
  const list = element('ol', 'version-list');
  list.setAttribute('aria-labelledby', title.id);
  list.append(
    ...history.map((version) => versionRow(version, shown, newestTipHash)),
  );

  const section = element('section', 'animal-versions');
  section.setAttribute('aria-labelledby', title.id);
  section.append(title, list);
  return section;
};

/**
 * The detail of one version. The newest tip (the first current entry of
 * the history, newest first) is the version the detail serves without
 * `?version=`, so it is the one that may be edited; a hash that happens to
 * name it reads as the current version, not as an old one.
 *
 * @param {AnimalDetail} animal
 * @param {AnimalVersion[]} history
 */
const detailView = (animal, history) => {
  const newestTipHash = history.find((version) => version.current)?.hash;
  const isNewestTip = animal.hash === newestTipHash;
  const view = element('section', 'animal-detail-view');
  const traits = traitChips(animal);
  view.append(
    headingRow(animal, isNewestTip),
    ...(isNewestTip ? [] : [oldVersionNotice(animal, history)]),
    factsBlock(animal),
    ...(traits === null ? [] : [traits]),
    storyParagraphs(animal.backgroundStory),
    versionsSection(history, animal, newestTipHash),
  );
  return view;
};

/**
 * The tables the detail reads from; a change set naming one of them
 * refreshes the current version.
 */
const shownTables = ['animals', 'animalTraits', 'species', 'breeders'];

/**
 * A version and its history the node does not have: the not-found view
 * takes the place of the detail.
 */
class AnimalNotFound extends Error {}

/**
 * Fetches one version of an animal and the animal's history. Fails with
 * `AnimalNotFound` for an unknown id or version.
 *
 * @param {string} id
 * @param {string | null} version
 */
const fetchAnimal = async (id, version) => {
  const detailPath =
    version === null
      ? `/api/animals/${encodeURIComponent(id)}`
      : `/api/animals/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`;
  const response = await fetch(detailPath, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) {
    throw new AnimalNotFound(
      version === null
        ? `There is no animal with id "${id}".`
        : `There is no version "${version}" of the animal "${id}".`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `The node answered ${response.status} ${response.statusText} for ${detailPath}.`,
    );
  }
  const animal = /** @type {AnimalDetail} */ (await response.json());
  const history = /** @type {AnimalVersion[]} */ (
    await fetchJson(`/api/animals/${encodeURIComponent(id)}/history`)
  );
  return { animal, history };
};

/**
 * Shows one animal: a heading with its name and an "Edit" action, a
 * compact facts block, its background story as paragraphs and the list of
 * its versions, reached from an animal card at `#/animals/<id>`; with
 * `?version=<hash>` it shows that older version read-only, with a notice
 * and a link back to the current one. Fetches `GET /api/animals/<id>` and
 * `GET /api/animals/<id>/history` when it enters the document; a hash
 * change replaces this element with a fresh instance (see `app.js`), which
 * re-reads the id and the version. Shows a loading, a not-found (unknown
 * id or version) or an error state with a retry button until the animal is
 * there. The current version then follows every change set of the node
 * that touches an animal, so an edit made in another tab or on another
 * node shows up with its new version in the list; an older version is a
 * fixed point in the history and stays as it is.
 */
class AnimalDetailElement extends HTMLElement {
  /** @type {LiveContent | null} */
  #detail = null;

  connectedCallback() {
    void this.load();
  }

  disconnectedCallback() {
    this.#detail?.stop();
  }

  async load() {
    const id = this.getAttribute('animal-id');
    if (id === null) {
      throw new Error('animal-detail requires an animal-id attribute.');
    }
    const version = requestedVersion();
    const build = async () => {
      const { animal, history } = await fetchAnimal(id, version);
      document.title = `${animal.name} · ${applicationName}`;
      return detailView(animal, history);
    };

    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(backLink(), statusMessage('Loading animal…'));
    try {
      if (version === null) {
        this.#detail ??= new LiveContent(shownTables, build);
        this.replaceChildren(backLink(), await this.#detail.show());
      } else {
        this.replaceChildren(backLink(), await build());
      }
    } catch (error) {
      if (error instanceof AnimalNotFound) {
        // The not-found view supplies its own way back, so it replaces the
        // persistent back link instead of sitting alongside a second one.
        this.replaceChildren(
          notFoundView(error.message, {
            href: animalListHref(),
            text: 'Back to Animals',
          }),
        );
        return;
      }
      this.replaceChildren(
        backLink(),
        errorState('Could not load the animal.', error, () => void this.load()),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('animal-detail', AnimalDetailElement);
