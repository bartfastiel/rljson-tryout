// @ts-check
import { fetchJson, postJson } from '../api.js';
import { element } from '../dom.js';
import { errorState, priceFormat, statusMessage } from '../view-helpers.js';

/**
 * The subset of `GET /api/customers` the customer choice needs.
 *
 * @typedef {object} FormCustomer
 * @property {string} id
 * @property {string} customerNumber
 * @property {{ name: string } | null} person
 */

/**
 * The subset of `GET /api/animals` the animal picker needs.
 *
 * @typedef {object} FormAnimal
 * @property {string} id
 * @property {string} name
 * @property {string | null} speciesName
 * @property {number} priceCents
 */

/**
 * One line of the invoice being built: an animal and how many of it.
 *
 * @typedef {object} FormLine
 * @property {FormAnimal} animal
 * @property {number} quantity
 */

/**
 * The invoice `POST /api/invoices` answers with; only the id is needed
 * here, to navigate to the detail view.
 *
 * @typedef {object} IssuedInvoice
 * @property {string} id
 */

const listHref = '#/invoices';

/**
 * @returns {HTMLAnchorElement}
 */
const backLink = () => {
  const link = element('a', 'back-link', '← Back to Invoices');
  link.href = listHref;
  return link;
};

const viewTitle = () => element('h1', 'view-title', 'New invoice');

/**
 * A labelled form control: the label sits above the control so that both
 * get the full width of a phone screen.
 *
 * @param {string} id
 * @param {string} labelText
 * @param {HTMLElement} control
 */
const formField = (id, labelText, control) => {
  const label = element('label', 'form-label', labelText);
  label.htmlFor = id;
  control.id = id;
  const field = element('div', 'form-field');
  field.append(label, control);
  return field;
};

/**
 * @param {FormCustomer} customer
 */
const customerLabel = (customer) =>
  `${customer.person?.name ?? 'Unknown person'} (${customer.customerNumber})`;

/**
 * The customer choice: a native `<select>` so that a phone shows its own
 * picker, with a placeholder option and `required`, so that the browser
 * refuses to submit before a customer is chosen.
 *
 * @param {FormCustomer[]} customers
 */
const customerSelect = (customers) => {
  const select = element('select', 'select');
  select.name = 'customerId';
  select.required = true;
  const placeholder = element('option', '', 'Choose a customer');
  placeholder.value = '';
  select.append(
    placeholder,
    ...customers.map((customer) => {
      const option = element('option', '', customerLabel(customer));
      option.value = customer.id;
      return option;
    }),
  );
  return select;
};

/**
 * Whether an animal matches a search text: a case-insensitive substring
 * of its name or species name, an empty search matching everything.
 *
 * @param {FormAnimal} animal
 * @param {string} search
 */
const matchesSearch = (animal, search) => {
  const needle = search.trim().toLowerCase();
  return (
    needle === '' ||
    animal.name.toLowerCase().includes(needle) ||
    (animal.speciesName ?? '').toLowerCase().includes(needle)
  );
};

/**
 * @param {FormAnimal} animal
 */
const animalMeta = (animal) =>
  `${animal.speciesName ?? 'Unknown species'} · ${priceFormat.format(animal.priceCents / 100)}`;

/**
 * The form for a new invoice, built once when the customers and animals
 * are loaded. State lives in `lines` (the animals added so far, in the
 * order they were added); `renderPicker` and `renderLines` redraw only
 * their own part of the form, so the customer choice and the search text
 * survive every change and focus stays where the person left it.
 *
 * @param {FormCustomer[]} customers
 * @param {FormAnimal[]} animals
 */
const invoiceForm = (customers, animals) => {
  /** @type {Map<string, FormLine>} */
  const lines = new Map();

  const form = element('form', 'invoice-form');

  const search = element('input', 'text-input');
  search.type = 'search';
  search.autocomplete = 'off';
  search.placeholder = 'Name or species';

  const pickerList = element('ul', 'animal-picker-list');
  pickerList.setAttribute('aria-label', 'Animals to add');

  const linesContainer = element('div', 'invoice-lines');

  const alert = element('p', 'form-error');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;

  const submit = element('button', 'button', 'Issue invoice');
  submit.type = 'submit';

  const showError = (/** @type {string} */ message) => {
    alert.textContent = message;
    alert.hidden = false;
  };

  const clearError = () => {
    alert.textContent = '';
    alert.hidden = true;
  };

  const renderPicker = () => {
    const matching = animals.filter((animal) =>
      matchesSearch(animal, search.value),
    );
    if (matching.length === 0) {
      pickerList.replaceChildren(
        element('li', 'animal-picker-empty', 'No animal matches this search.'),
      );
      return;
    }
    pickerList.replaceChildren(
      ...matching.map((animal) => {
        const text = element('div', 'animal-picker-text');
        text.append(
          element('span', 'animal-picker-name', animal.name),
          element('span', 'animal-picker-meta', animalMeta(animal)),
        );
        const add = element('button', 'button button-secondary', 'Add');
        add.type = 'button';
        add.setAttribute('aria-label', `Add ${animal.name}`);
        add.addEventListener('click', () => {
          const line = lines.get(animal.id);
          if (line === undefined) {
            lines.set(animal.id, { animal, quantity: 1 });
          } else {
            line.quantity += 1;
          }
          clearError();
          renderLines();
        });
        const row = element('li', 'animal-picker-row');
        row.append(text, add);
        return row;
      }),
    );
  };

  /**
   * @param {FormLine} line
   * @param {string} label
   * @param {string} text
   * @param {number} change
   */
  const stepperButton = (line, label, text, change) => {
    const button = element('button', 'stepper-button', text);
    button.type = 'button';
    button.setAttribute('aria-label', `${label} of ${line.animal.name}`);
    button.dataset.focusKey = `${label}:${line.animal.id}`;
    button.addEventListener('click', () => {
      line.quantity += change;
      if (line.quantity < 1) {
        lines.delete(line.animal.id);
      }
      clearError();
      renderLines();
    });
    return button;
  };

  /**
   * @param {FormLine} line
   */
  const lineRow = (line) => {
    const text = element('div', 'invoice-line-text');
    text.append(
      element('span', 'invoice-line-name', line.animal.name),
      element(
        'span',
        'invoice-line-price',
        `${priceFormat.format(line.animal.priceCents / 100)} each`,
      ),
    );

    const quantity = element('span', 'stepper-value', String(line.quantity));
    const stepper = element('div', 'stepper');
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', `Quantity of ${line.animal.name}`);
    stepper.append(
      stepperButton(line, 'Decrease quantity', '−', -1),
      quantity,
      stepperButton(line, 'Increase quantity', '+', 1),
    );

    const row = element('li', 'invoice-line');
    row.append(
      text,
      stepper,
      element(
        'span',
        'invoice-line-total',
        priceFormat.format((line.quantity * line.animal.priceCents) / 100),
      ),
    );
    return row;
  };

  /**
   * Redraws the items and the running total. A stepper button that had
   * focus is focused again after the redraw (by its animal and direction),
   * so that pressing Enter repeatedly keeps counting; when its line was
   * just removed, focus moves back to the search field, the natural place
   * to add the next animal from.
   */
  const renderLines = () => {
    const focused = document.activeElement;
    const focusKey =
      focused instanceof HTMLElement ? focused.dataset.focusKey : undefined;

    const totalCents = [...lines.values()].reduce(
      (total, line) => total + line.quantity * line.animal.priceCents,
      0,
    );
    const total = element('p', 'invoice-total-row');
    total.append(
      element('span', '', 'Total'),
      element(
        'strong',
        'invoice-total-amount',
        priceFormat.format(totalCents / 100),
      ),
    );

    if (lines.size === 0) {
      linesContainer.replaceChildren(
        statusMessage('No items yet. Add an animal from the list above.'),
        total,
      );
    } else {
      const list = element('ul', 'invoice-line-list');
      list.setAttribute('aria-label', 'Invoice items');
      list.append(...[...lines.values()].map(lineRow));
      linesContainer.replaceChildren(list, total);
    }

    if (focusKey !== undefined) {
      const again = linesContainer.querySelector(
        `[data-focus-key="${CSS.escape(focusKey)}"]`,
      );
      if (again instanceof HTMLElement) {
        again.focus();
      } else {
        search.focus();
      }
    }
  };

  const select = customerSelect(customers);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const issued = /** @type {IssuedInvoice} */ (
        await postJson('/api/invoices', {
          customerId: select.value,
          items: [...lines.values()].map((line) => ({
            animalId: line.animal.id,
            quantity: line.quantity,
          })),
        })
      );
      location.hash = `#/invoices/${encodeURIComponent(issued.id)}`;
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });

  search.addEventListener('input', renderPicker);

  const pickerTitle = element('h2', 'section-title', 'Add animals');
  pickerTitle.id = 'animal-picker-title';
  const picker = element('section', 'animal-picker');
  picker.setAttribute('aria-labelledby', pickerTitle.id);
  picker.append(
    pickerTitle,
    formField('animal-search', 'Search animals', search),
    pickerList,
  );

  const linesTitle = element('h2', 'section-title', 'Items');
  linesTitle.id = 'invoice-lines-title';
  const linesSection = element('section', 'invoice-items');
  linesSection.setAttribute('aria-labelledby', linesTitle.id);
  linesSection.append(linesTitle, linesContainer);

  form.append(
    formField('invoice-customer', 'Customer', select),
    picker,
    linesSection,
    alert,
    submit,
  );
  renderPicker();
  renderLines();
  return form;
};

/**
 * The form for a new invoice at `#/invoices/new`: choose a customer, add
 * animals from a searchable list, adjust quantities with a stepper per
 * line, watch the running total and submit. Fetches `/api/customers` and
 * `/api/animals` when it enters the document; a successful submit
 * navigates to the new invoice's detail page, a refused one shows the
 * node's message inline above the submit button.
 */
class InvoiceForm extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(
      backLink(),
      viewTitle(),
      statusMessage('Loading customers and animals…'),
    );
    try {
      const [customers, animals] = await Promise.all([
        /** @type {Promise<FormCustomer[]>} */ (fetchJson('/api/customers')),
        /** @type {Promise<FormAnimal[]>} */ (fetchJson('/api/animals')),
      ]);
      this.replaceChildren(
        backLink(),
        viewTitle(),
        invoiceForm(customers, animals),
      );
    } catch (error) {
      this.replaceChildren(
        backLink(),
        viewTitle(),
        errorState('Could not load the form.', error, () => void this.load()),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('invoice-form', InvoiceForm);
