// @ts-check
import { fetchJson } from '../api.js';
import { element } from '../dom.js';
import {
  dateFormat,
  errorState,
  parseDateOnly,
  priceFormat,
  statusBadge,
  statusMessage,
} from '../view-helpers.js';

/**
 * The customer of an invoice as `GET /api/invoices` joins it in. `null`
 * for the unreachable case of a dangling `customerRef` (see
 * `PetShopStore.listInvoices`).
 *
 * @typedef {object} InvoiceCustomerSummary
 * @property {string} id
 * @property {string} customerNumber
 * @property {string | null} personName
 */

/**
 * One invoice as `GET /api/invoices` returns it.
 *
 * @typedef {object} InvoiceSummary
 * @property {string} id
 * @property {string} hash
 * @property {string} invoiceNumber
 * @property {string} issuedOn
 * @property {string} status
 * @property {InvoiceCustomerSummary | null} customer
 * @property {number} totalCents
 * @property {number} itemCount
 */

/**
 * The heading row of the view: the title and, next to it, the prominent
 * button that opens the form for a new invoice, which is the one thing a
 * person comes to this view to do.
 */
const viewHeader = () => {
  const newInvoiceLink = element('a', 'button', 'New invoice');
  newInvoiceLink.href = '#/invoices/new';

  const header = element('div', 'view-header');
  header.append(element('h1', 'view-title', 'Invoices'), newInvoiceLink);
  return header;
};

/**
 * @param {InvoiceSummary} invoice
 */
const invoiceCard = (invoice) => {
  const heading = element('h2', 'invoice-number', invoice.invoiceNumber);
  const headingRow = element('div', 'invoice-card-heading');
  headingRow.append(heading, statusBadge(invoice.status));

  const meta = element('p', 'invoice-meta');
  meta.append(
    element(
      'span',
      'invoice-customer',
      invoice.customer?.personName ?? 'Unknown customer',
    ),
    element(
      'span',
      'invoice-issued-on',
      dateFormat.format(parseDateOnly(invoice.issuedOn)),
    ),
    element(
      'span',
      'invoice-item-count',
      `${invoice.itemCount} ${invoice.itemCount === 1 ? 'item' : 'items'}`,
    ),
  );

  // The whole card is one link to the invoice's detail page, the same
  // pattern the animal and breeder cards use for one large tap target.
  const card = element('a', 'card invoice-card');
  card.href = `#/invoices/${encodeURIComponent(invoice.id)}`;
  card.append(
    headingRow,
    meta,
    element('p', 'invoice-total', priceFormat.format(invoice.totalCents / 100)),
  );

  const item = element('li', 'card-list-item');
  item.append(card);
  return item;
};

/**
 * @param {InvoiceSummary[]} invoices
 */
const invoiceCards = (invoices) => {
  if (invoices.length === 0) {
    return statusMessage('No invoices yet.');
  }
  const list = element('ul', 'card-list');
  list.setAttribute('role', 'list');
  list.append(...invoices.map(invoiceCard));
  return list;
};

/**
 * Lists the invoices of this node as cards (number, status badge, customer,
 * issue date, item count, total), newest first as the API serves them,
 * each linking to the invoice's detail page (`#/invoices/<id>`), with a
 * "New invoice" button leading to the form. Fetches `/api/invoices` when it
 * enters the document and shows a loading, an empty or an error state with
 * a retry button until the list is there.
 */
class InvoicesList extends HTMLElement {
  connectedCallback() {
    void this.load();
  }

  async load() {
    this.setAttribute('aria-busy', 'true');
    this.replaceChildren(viewHeader(), statusMessage('Loading invoices…'));
    try {
      const invoices = /** @type {InvoiceSummary[]} */ (
        await fetchJson('/api/invoices')
      );
      this.replaceChildren(viewHeader(), invoiceCards(invoices));
    } catch (error) {
      this.replaceChildren(
        viewHeader(),
        errorState(
          'Could not load the invoices.',
          error,
          () => void this.load(),
        ),
      );
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

customElements.define('invoices-list', InvoicesList);
