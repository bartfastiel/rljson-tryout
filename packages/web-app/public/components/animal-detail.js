// @ts-check
import { element } from '../dom.js';
import { hashQuery } from '../hash-route.js';
import { notFoundView } from '../not-found-view.js';
import {
  applicationName,
  dateFormat,
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
 * The href of the list a "back" link should return to: the filtered list
 * the detail was opened from, carrying along whichever of `species`,
 * `breeder` and `trait` this view's own hash query holds (the animal card
 * that links here puts them there, see `animals-list.js`), the full list
 * when none is present.
 */
const listHref = () => {
  const query = hashQuery(location.hash);
  const speciesId = query.get('species');
  const breederId = query.get('breeder');
  const traitId = query.get('trait');

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
  const queryString = params.toString();
  return queryString === '' ? '#/animals' : `#/animals?${queryString}`;
};

/**
 * @returns {HTMLAnchorElement}
 */
const backLink = () => {
  const link = element('a', 'back-link', '← Back to Animals');
  link.href = listHref();
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
 * @param {AnimalDetail} animal
 */
const detailView = (animal) => {
  const view = element('section', 'animal-detail-view');
  const traits = traitChips(animal);
  view.append(
    element('h1', 'view-title', animal.name),
    factsBlock(animal),
    ...(traits === null ? [] : [traits]),
    storyParagraphs(animal.backgroundStory),
  );
  return view;
};

/**
 * Shows one animal: a heading with its name, a compact facts block and its
 * background story as paragraphs, reached from an animal card at
 * `#/animals/<id>`. Fetches `GET /api/animals/<id>` when it enters the
 * document; a hash change replaces this element with a fresh instance (see
 * `app.js`), which re-reads the id. Shows a loading, a not-found (unknown
 * id) or an error state with a retry button until the animal is there.
 */
class AnimalDetailElement extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    const id = this.getAttribute('animal-id');
    if (id === null) {
      throw new Error('animal-detail requires an animal-id attribute.');
    }

    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(backLink(), statusMessage('Loading animal…'));
    try {
      const response = await fetch(`/api/animals/${encodeURIComponent(id)}`, {
        headers: { accept: 'application/json' },
      });
      if (response.status === 404) {
        // The not-found view supplies its own way back, so it replaces the
        // persistent back link instead of sitting alongside a second one.
        this.replaceChildren(
          notFoundView(`There is no animal with id "${id}".`, {
            href: listHref(),
            text: 'Back to Animals',
          }),
        );
        return;
      }
      if (!response.ok) {
        throw new Error(
          `The node answered ${response.status} ${response.statusText} for /api/animals/${id}.`,
        );
      }
      const animal = /** @type {AnimalDetail} */ (await response.json());
      document.title = `${animal.name} · ${applicationName}`;
      this.replaceChildren(backLink(), detailView(animal));
    } catch (error) {
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
