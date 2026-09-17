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
 * One animal as `GET /api/animals/:id` returns it: the fields the detail
 * view needs, with its species joined and the full background story.
 * `speciesId` and `speciesName` are `null` for the unreachable case of a
 * dangling `speciesRef` (see `PetShopStore.getAnimal`).
 *
 * @typedef {object} AnimalDetail
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string | null} speciesId
 * @property {string | null} speciesName
 * @property {string} bornOn
 * @property {number} priceCents
 * @property {string} backgroundStory
 */

/**
 * The href of the list a "back" link should return to: the filtered list
 * the detail was opened from, when this view's own hash carries a `species`
 * query parameter (the animal card that links here puts it there, see
 * `animals-list.js`), the full list otherwise.
 */
const listHref = () => {
  const speciesId = hashQuery(location.hash).get('species');
  return speciesId === null
    ? '#/animals'
    : `#/animals?species=${encodeURIComponent(speciesId)}`;
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
 * The compact facts block: species as a link to the filtered list, born
 * date and price.
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

  const facts = element('dl', 'animal-facts');
  facts.append(
    element('dt', '', 'Species'),
    speciesValue,
    element('dt', '', 'Born'),
    element('dd', '', dateFormat.format(parseDateOnly(animal.bornOn))),
    element('dt', '', 'Price'),
    element('dd', '', priceFormat.format(animal.priceCents / 100)),
  );
  return facts;
};

/**
 * @param {AnimalDetail} animal
 */
const detailView = (animal) => {
  const view = element('section', 'animal-detail-view');
  view.append(
    element('h1', 'view-title', animal.name),
    factsBlock(animal),
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
