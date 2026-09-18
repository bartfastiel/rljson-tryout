// @ts-check
import { fetchJson, postFile } from '../api.js';
import { element } from '../dom.js';
import { LiveContent } from '../live-content.js';
import { errorState, statusMessage } from '../view-helpers.js';

/**
 * One species as `GET /api/species` returns it and
 * `POST /api/species/:id/image` answers with.
 *
 * @typedef {object} Species
 * @property {string} id
 * @property {string} hash
 * @property {string} name
 * @property {string} latinName
 * @property {string} description
 * @property {string} imageUrl
 */

/** What the node accepts as a species image, checked here before it is sent. */
const acceptedImageTypes = ['image/png', 'image/jpeg'];
const maximumImageBytes = 1024 * 1024;

const viewTitle = () => element('h1', 'view-title', 'Species');

/**
 * The badge or photo of a species at the top of its card. The intrinsic
 * size and the square aspect ratio reserve the space before the bytes
 * arrive, so the text below does not jump; the image loads lazily since a
 * long list of species scrolls past most of them.
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
 * "12.7 kB" for a size in bytes, one decimal from a kilobyte on.
 *
 * @param {number} bytes
 */
const formatBytes = (bytes) =>
  bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;

/**
 * Why a chosen file is not sent, `null` when it is: the same two rules the
 * node applies, so that a phone never uploads what the node would refuse.
 *
 * @param {File} file
 */
const fileProblem = (file) => {
  if (!acceptedImageTypes.includes(file.type)) {
    return 'Choose a PNG or JPEG image.';
  }
  if (file.size > maximumImageBytes) {
    return `The image must be 1 MB or smaller; this one is ${formatBytes(file.size)}.`;
  }
  return null;
};

/**
 * The control that gives a species a new image: a label styled as a
 * button over a file input a phone answers with its camera
 * (`capture="environment"`) or its gallery, a status line while the bytes
 * travel and the node's own message when it refused them. A file that is
 * not a PNG or JPEG, or bigger than a mebibyte, never leaves the device.
 * On success the card's image is swapped for the new version's at once,
 * which is the feedback; the whole list rebuilds from the node's
 * `insert` event a moment later anyway, which is what a second browser
 * sees too.
 *
 * @param {Species} species
 * @param {HTMLImageElement} image
 */
const uploadControl = (species, image) => {
  const input = element('input', 'visually-hidden species-upload-input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.id = `species-image-upload-${species.id}`;

  const label = element('label', 'button button-secondary');
  label.htmlFor = input.id;
  label.append(
    document.createTextNode('Upload image'),
    element('span', 'visually-hidden', ` for ${species.name}`),
  );

  const message = element('p', 'species-upload-message');
  message.hidden = true;

  /**
   * @param {'status' | 'alert'} role
   * @param {string} text
   */
  const say = (role, text) => {
    message.setAttribute('role', role);
    message.classList.toggle('species-upload-error', role === 'alert');
    message.textContent = text;
    message.hidden = false;
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    const problem = fileProblem(file);
    if (problem !== null) {
      say('alert', problem);
      input.value = '';
      return;
    }
    input.disabled = true;
    label.setAttribute('aria-busy', 'true');
    say('status', `Uploading ${formatBytes(file.size)}…`);
    try {
      const updated = /** @type {Species} */ (
        await postFile(
          `/api/species/${encodeURIComponent(species.id)}/image`,
          file,
        )
      );
      image.src = updated.imageUrl;
      message.hidden = true;
    } catch (error) {
      say('alert', error instanceof Error ? error.message : String(error));
    } finally {
      input.disabled = false;
      label.removeAttribute('aria-busy');
      input.value = '';
    }
  });

  const control = element('div', 'species-upload');
  control.append(input, label);
  return { control, message };
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

  const image = speciesImage(species);
  const upload = uploadControl(species, image);
  const actions = element('div', 'species-actions');
  actions.append(animalsLink, upload.control);

  const card = element('article', 'card species-card');
  card.append(
    image,
    element('h2', 'species-name', species.name),
    latinNameLine,
    element('p', 'species-description', species.description),
    actions,
    upload.message,
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
 * Lists the species of this node as cards, each with a control to give
 * the species a new image from the phone's camera or a file. Fetches
 * `/api/species` when it enters the document and shows a loading, an
 * empty or an error state with a retry button until the list is there;
 * from then on the cards follow every change set of the node that touches
 * the species, an uploaded image included.
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
