// @ts-check
import { fetchJson, putJson } from '../api.js';
import { element } from '../dom.js';
import { animalDetailHref, animalListHref } from '../hash-route.js';
import { notFoundView } from '../not-found-view.js';
import { applicationName, errorState, statusMessage } from '../view-helpers.js';

/**
 * The subset of `GET /api/animals/:id` the form edits.
 *
 * @typedef {object} EditableAnimal
 * @property {string} id
 * @property {string} name
 * @property {string | null} speciesId
 * @property {string | null} breederId
 * @property {string} bornOn
 * @property {number} priceCents
 * @property {string} backgroundStory
 * @property {{ id: string, name: string }[]} traits
 */

/**
 * The subset of `GET /api/species` the species choice needs.
 *
 * @typedef {object} FormSpecies
 * @property {string} id
 * @property {string} name
 */

/**
 * The subset of `GET /api/breeders` the breeder choice needs.
 *
 * @typedef {object} FormBreeder
 * @property {string} id
 * @property {string} farmName
 */

/**
 * The subset of `GET /api/traits` the trait toggles need.
 *
 * @typedef {object} FormTrait
 * @property {string} id
 * @property {string} name
 */

/**
 * A labelled form control with a place for its own validation message:
 * the label sits above the control so that both get the full width of a
 * phone screen, the message sits below it and is announced through
 * `aria-describedby` once shown.
 *
 * @typedef {object} FormField
 * @property {HTMLDivElement} field
 * @property {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control
 * @property {(message: string) => void} showProblem
 * @property {() => void} clearProblem
 */

/**
 * The detail this form returns to, with the list filter the detail's Edit
 * action carried into this hash, so that the way back from the detail
 * still leads to the filtered list.
 *
 * @param {EditableAnimal} animal
 * @returns {HTMLAnchorElement}
 */
const backLink = (animal) => {
  const link = element('a', 'back-link', `← Back to ${animal.name}`);
  link.href = animalDetailHref(animal.id, null);
  return link;
};

/**
 * @param {string} id
 * @param {string} labelText
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control
 * @returns {FormField}
 */
const formField = (id, labelText, control) => {
  const label = element('label', 'form-label', labelText);
  label.htmlFor = id;
  control.id = id;
  const problem = element('p', 'field-error');
  problem.id = `${id}-error`;
  problem.hidden = true;
  const field = element('div', 'form-field');
  field.append(label, control, problem);

  return {
    field,
    control,
    showProblem: (message) => {
      problem.textContent = message;
      problem.hidden = false;
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', problem.id);
    },
    clearProblem: () => {
      problem.textContent = '';
      problem.hidden = true;
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    },
  };
};

/**
 * A native `<select>`, so that a phone shows its own picker, with one
 * option per entry and the given one preselected. The placeholder is what
 * an animal whose reference does not resolve (`speciesId: null`) starts
 * on, so that saving it asks for a choice instead of silently picking the
 * first entry.
 *
 * @param {string} name
 * @param {string} placeholder
 * @param {{ id: string, label: string }[]} entries
 * @param {string | null} selectedId
 */
const selectOf = (name, placeholder, entries, selectedId) => {
  const select = element('select', 'select');
  select.name = name;
  select.required = true;
  const placeholderOption = element('option', '', placeholder);
  placeholderOption.value = '';
  placeholderOption.selected = !entries.some(
    (entry) => entry.id === selectedId,
  );
  select.append(
    placeholderOption,
    ...entries.map((entry) => {
      const option = element('option', '', entry.label);
      option.value = entry.id;
      option.selected = entry.id === selectedId;
      return option;
    }),
  );
  return select;
};

/**
 * @param {string} name
 * @param {string} type
 * @param {string} value
 */
const inputOf = (name, type, value) => {
  const input = element('input', 'text-input');
  input.name = name;
  input.type = type;
  input.value = value;
  return input;
};

/**
 * A story field that grows with its content instead of scrolling inside a
 * fixed box, so that a long story is edited like a page and never hides
 * text behind a scroll bar the size of a phone's keyboard. `fit` measures
 * after the element is in the document, since `scrollHeight` is zero
 * before.
 *
 * @param {string} value
 */
const growingTextarea = (value) => {
  const textarea = element('textarea', 'text-input textarea');
  textarea.name = 'backgroundStory';
  textarea.rows = 4;
  textarea.value = value;
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', fit);
  return { textarea, fit };
};

/**
 * The traits as toggle chips: a `<button>` per trait whose `aria-pressed`
 * says whether the animal carries it, so that a trait is added or removed
 * with one tap or one press of Space, and a screen reader hears the state.
 *
 * @param {FormTrait[]} traits
 * @param {Set<string>} selectedIds
 */
const traitToggles = (traits, selectedIds) => {
  const legend = element('legend', 'form-label', 'Traits');
  const chips = element('div', 'trait-toggles');
  chips.append(
    ...traits.map((trait) => {
      const chip = element('button', 'chip', trait.name);
      chip.type = 'button';
      chip.dataset.traitId = trait.id;
      chip.setAttribute('aria-pressed', String(selectedIds.has(trait.id)));
      chip.addEventListener('click', () => {
        const pressed = chip.getAttribute('aria-pressed') !== 'true';
        chip.setAttribute('aria-pressed', String(pressed));
        if (pressed) {
          selectedIds.add(trait.id);
        } else {
          selectedIds.delete(trait.id);
        }
      });
      return chip;
    }),
  );
  const fieldset = element('fieldset', 'form-fieldset');
  fieldset.append(legend, chips);
  return fieldset;
};

/**
 * The price in cents a euro amount typed into the price field stands for,
 * or `null` when the text is not a non-negative amount with at most two
 * decimals. Cents are what the node stores, so the conversion happens
 * here, once, and rounding never produces a fraction of a cent.
 *
 * @param {string} text
 */
const centsOf = (text) => {
  const trimmed = text.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  return Math.round(Number(trimmed.replace(',', '.')) * 100);
};

/**
 * Whether a date field's value is a calendar date. A date input only ever
 * holds `YYYY-MM-DD` or the empty string, so the check is for emptiness
 * plus the same round trip the node performs.
 *
 * @param {string} value
 */
const isCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
};

/**
 * The edit form, built once when the animal and the choices are loaded.
 * Every field is validated inline: for every field at once when the form
 * is submitted, which then focuses the first field with a problem instead
 * of sending anything, and from then on again on every keystroke, so that
 * a message appears while the person types and never on leaving the
 * field: a message inserted on blur would push the Save button down under
 * the very tap that blurred the field. A successful save navigates to the
 * animal's detail, where the new version is the current one; a refused
 * save shows the node's message above the buttons.
 *
 * @param {EditableAnimal} animal
 * @param {FormSpecies[]} species
 * @param {FormBreeder[]} breeders
 * @param {FormTrait[]} traits
 */
const animalForm = (animal, species, breeders, traits) => {
  const form = element('form', 'animal-form');
  form.noValidate = true;

  const name = formField(
    'animal-name',
    'Name',
    inputOf('name', 'text', animal.name),
  );
  const speciesField = formField(
    'animal-species',
    'Species',
    selectOf(
      'speciesId',
      'Choose a species',
      species.map((entry) => ({ id: entry.id, label: entry.name })),
      animal.speciesId,
    ),
  );
  const breederField = formField(
    'animal-breeder',
    'Breeder',
    selectOf(
      'breederId',
      'Choose a breeder',
      breeders.map((entry) => ({ id: entry.id, label: entry.farmName })),
      animal.breederId,
    ),
  );
  const bornOn = formField(
    'animal-born-on',
    'Born on',
    inputOf('bornOn', 'date', animal.bornOn),
  );
  const priceInput = inputOf(
    'priceEuros',
    'text',
    (animal.priceCents / 100).toFixed(2),
  );
  priceInput.inputMode = 'decimal';
  const price = formField('animal-price', 'Price in euros', priceInput);
  const story = growingTextarea(animal.backgroundStory);
  const storyField = formField(
    'animal-story',
    'Background story',
    story.textarea,
  );
  const selectedTraitIds = new Set(animal.traits.map((trait) => trait.id));

  /** @type {{ field: FormField, problem: () => string | null }[]} */
  const checks = [
    {
      field: name,
      problem: () =>
        name.control.value.trim() === '' ? 'The name must not be empty.' : null,
    },
    {
      field: speciesField,
      problem: () =>
        speciesField.control.value === '' ? 'Choose a species.' : null,
    },
    {
      field: breederField,
      problem: () =>
        breederField.control.value === '' ? 'Choose a breeder.' : null,
    },
    {
      field: bornOn,
      problem: () =>
        isCalendarDate(bornOn.control.value)
          ? null
          : 'The birth date must be a calendar date such as 2024-05-31.',
    },
    {
      field: price,
      problem: () =>
        centsOf(price.control.value) === null
          ? 'The price must be 0.00 or more, with at most two decimals.'
          : null,
    },
  ];

  /**
   * Validates one field and shows or clears its message; `true` when the
   * field is fine.
   *
   * @param {{ field: FormField, problem: () => string | null }} check
   */
  const validate = (check) => {
    const problem = check.problem();
    if (problem === null) {
      check.field.clearProblem();
      return true;
    }
    check.field.showProblem(problem);
    return false;
  };

  let submitAttempted = false;
  for (const check of checks) {
    check.field.control.addEventListener('input', () => {
      if (submitAttempted) {
        validate(check);
      }
    });
  }

  const alert = element('p', 'form-error');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;

  const save = element('button', 'button', 'Save');
  save.type = 'submit';
  const cancel = element('a', 'button button-secondary', 'Cancel');
  cancel.href = animalDetailHref(animal.id, null);
  const actions = element('div', 'form-actions');
  actions.append(save, cancel);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.hidden = true;
    submitAttempted = true;
    const invalid = checks.filter((check) => !validate(check));
    if (invalid.length > 0) {
      invalid[0].field.control.focus();
      return;
    }
    save.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      await putJson(`/api/animals/${encodeURIComponent(animal.id)}`, {
        name: name.control.value.trim(),
        speciesId: speciesField.control.value,
        breederId: breederField.control.value,
        bornOn: bornOn.control.value,
        priceCents: centsOf(price.control.value),
        backgroundStory: story.textarea.value,
        traitIds: traits
          .map((trait) => trait.id)
          .filter((traitId) => selectedTraitIds.has(traitId)),
      });
      location.hash = animalDetailHref(animal.id, null);
    } catch (error) {
      alert.textContent =
        error instanceof Error ? error.message : String(error);
      alert.hidden = false;
    } finally {
      save.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });

  form.append(
    name.field,
    speciesField.field,
    breederField.field,
    bornOn.field,
    price.field,
    storyField.field,
    traitToggles(traits, selectedTraitIds),
    alert,
    actions,
  );
  return { form, fitStory: story.fit };
};

/**
 * The form that writes a new version of one animal, at
 * `#/animals/<id>/edit`: every editable field (name, species, breeder,
 * birth date, price in euros, background story, traits as toggle chips),
 * validated inline, saved with one tap. Fetches the animal, the species,
 * the breeders and the traits when it enters the document; an unknown id
 * shows the not-found view. Saving navigates to the animal's detail, whose
 * version list then shows the new version as current.
 */
class AnimalFormElement extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    const id = this.getAttribute('animal-id');
    if (id === null) {
      throw new Error('animal-form requires an animal-id attribute.');
    }

    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(statusMessage('Loading animal…'));
    try {
      const response = await fetch(`/api/animals/${encodeURIComponent(id)}`, {
        headers: { accept: 'application/json' },
      });
      if (response.status === 404) {
        this.replaceChildren(
          notFoundView(`There is no animal with id "${id}".`, {
            href: animalListHref(),
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
      const animal = /** @type {EditableAnimal} */ (await response.json());
      const [species, breeders, traits] = await Promise.all([
        /** @type {Promise<FormSpecies[]>} */ (fetchJson('/api/species')),
        /** @type {Promise<FormBreeder[]>} */ (fetchJson('/api/breeders')),
        /** @type {Promise<FormTrait[]>} */ (fetchJson('/api/traits')),
      ]);
      document.title = `Edit ${animal.name} · ${applicationName}`;
      const { form, fitStory } = animalForm(animal, species, breeders, traits);
      this.replaceChildren(
        backLink(animal),
        element('h1', 'view-title', `Edit ${animal.name}`),
        form,
      );
      fitStory();
    } catch (error) {
      this.replaceChildren(
        errorState('Could not load the animal.', error, () => void this.load()),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('animal-form', AnimalFormElement);
