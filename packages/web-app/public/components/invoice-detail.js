// @ts-check
import { element } from '../dom.js';
import { notFoundView } from '../not-found-view.js';
import {
  applicationName,
  dateFormat,
  errorState,
  parseDateOnly,
  priceFormat,
  statusBadge,
  statusMessage,
} from '../view-helpers.js';

/**
 * The animal an invoice item sold, as `GET /api/invoices/:id` joins it in.
 * `null` for the unreachable case of a dangling `animalRef` (see
 * `PetShopStore.getInvoice`).
 *
 * @typedef {object} InvoiceItemAnimal
 * @property {string} id
 * @property {string} name
 * @property {string | null} speciesName
 */

/**
 * One line of an invoice as `GET /api/invoices/:id` returns it.
 *
 * @typedef {object} InvoiceItem
 * @property {string} id
 * @property {string} hash
 * @property {InvoiceItemAnimal | null} animal
 * @property {number} quantity
 * @property {number} unitPriceCents
 * @property {number} lineTotalCents
 */

/**
 * The customer of an invoice with their person, as `GET /api/invoices/:id`
 * joins them in.
 *
 * @typedef {object} InvoiceCustomer
 * @property {string} id
 * @property {string} customerNumber
 * @property {{ id: string, name: string, city: string } | null} person
 */

/**
 * One invoice as `GET /api/invoices/:id` returns it.
 *
 * @typedef {object} InvoiceDetail
 * @property {string} id
 * @property {string} hash
 * @property {string} invoiceNumber
 * @property {string} issuedOn
 * @property {string} status
 * @property {InvoiceCustomer | null} customer
 * @property {InvoiceItem[]} items
 * @property {number} totalCents
 * @property {string | null} changeSetHash
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

/**
 * @param {InvoiceDetail} invoice
 */
const factsBlock = (invoice) => {
  const customerName = invoice.customer?.person?.name ?? 'Unknown customer';
  const customerText =
    invoice.customer === null
      ? customerName
      : `${customerName} (${invoice.customer.customerNumber})`;
  const statusValue = element('dd', '');
  statusValue.append(statusBadge(invoice.status));

  const facts = element('dl', 'animal-facts');
  facts.append(
    element('dt', '', 'Customer'),
    element('dd', '', customerText),
    element('dt', '', 'Issued on'),
    element('dd', '', dateFormat.format(parseDateOnly(invoice.issuedOn))),
    element('dt', '', 'Status'),
    statusValue,
  );
  return facts;
};

/**
 * One line: the animal's name as a link to its detail page, the quantity
 * and unit price, and the line total.
 *
 * @param {InvoiceItem} item
 */
const itemRow = (item) => {
  const name = element('span', 'invoice-line-name');
  if (item.animal === null) {
    name.textContent = 'Unknown animal';
  } else {
    const link = element('a', '', item.animal.name);
    link.href = `#/animals/${encodeURIComponent(item.animal.id)}`;
    name.append(link);
  }

  const text = element('div', 'invoice-line-text');
  text.append(
    name,
    element(
      'span',
      'invoice-line-price',
      `${item.quantity} × ${priceFormat.format(item.unitPriceCents / 100)}`,
    ),
  );

  const row = element('li', 'invoice-line');
  row.append(
    text,
    element(
      'span',
      'invoice-line-total',
      priceFormat.format(item.lineTotalCents / 100),
    ),
  );
  return row;
};

/**
 * @param {InvoiceDetail} invoice
 */
const itemsBlock = (invoice) => {
  const list = element('ul', 'invoice-line-list');
  list.setAttribute('aria-label', 'Items');
  list.append(...invoice.items.map(itemRow));

  const total = element('p', 'invoice-total-row');
  total.append(
    element('span', '', 'Total'),
    element(
      'strong',
      'invoice-total-amount',
      priceFormat.format(invoice.totalCents / 100),
    ),
  );

  const block = element('section', 'invoice-items');
  block.setAttribute('aria-labelledby', 'invoice-items-title');
  const title = element('h2', 'section-title', 'Items');
  title.id = 'invoice-items-title';
  block.append(title, list, total);
  return block;
};

/**
 * The change set hash in small print: the identity of the change that
 * wrote this invoice, which is what this node announces to its peers.
 *
 * @param {InvoiceDetail} invoice
 */
const changeSetNote = (invoice) =>
  element(
    'p',
    'invoice-change-set',
    invoice.changeSetHash === null
      ? 'No change set names this invoice.'
      : `Change set ${invoice.changeSetHash}`,
  );

/**
 * @param {InvoiceDetail} invoice
 */
const detailView = (invoice) => {
  const view = element('section', 'invoice-detail-view');
  view.append(
    element('h1', 'view-title', `Invoice ${invoice.invoiceNumber}`),
    factsBlock(invoice),
    itemsBlock(invoice),
    changeSetNote(invoice),
  );
  return view;
};

/**
 * Shows one invoice: its number as the heading, customer, issue date and
 * status, its items with the animal linked, quantity, unit price and line
 * total, the total and, in small print, the hash of the change set that
 * wrote it. Reached from an invoice card or right after issuing one, at
 * `#/invoices/<id>`. Fetches `GET /api/invoices/<id>` when it enters the
 * document; shows a loading, a not-found (unknown id) or an error state
 * with a retry button until the invoice is there.
 */
class InvoiceDetailElement extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    const id = this.getAttribute('invoice-id');
    if (id === null) {
      throw new Error('invoice-detail requires an invoice-id attribute.');
    }

    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(backLink(), statusMessage('Loading invoice…'));
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
        headers: { accept: 'application/json' },
      });
      if (response.status === 404) {
        this.replaceChildren(
          notFoundView(`There is no invoice with id "${id}".`, {
            href: listHref,
            text: 'Back to Invoices',
          }),
        );
        return;
      }
      if (!response.ok) {
        throw new Error(
          `The node answered ${response.status} ${response.statusText} for /api/invoices/${id}.`,
        );
      }
      const invoice = /** @type {InvoiceDetail} */ (await response.json());
      document.title = `Invoice ${invoice.invoiceNumber} · ${applicationName}`;
      this.replaceChildren(backLink(), detailView(invoice));
    } catch (error) {
      this.replaceChildren(
        backLink(),
        errorState(
          'Could not load the invoice.',
          error,
          () => void this.load(),
        ),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('invoice-detail', InvoiceDetailElement);
