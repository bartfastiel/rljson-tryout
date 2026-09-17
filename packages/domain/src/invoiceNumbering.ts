/**
 * How invoices, their items and the change set that writes them are
 * numbered and identified. Everything derives from the invoice number, so
 * an invoice, its items and its change set can be recognised as one
 * operation by eye in any table dump.
 */

/**
 * The invoice number printed on an invoice: the year of the issue date and
 * a running sequence, zero-padded to four digits so that numbers sort
 * lexicographically in issue order (`2026-0007`). The sequence is the
 * count of invoices that already exist on the node plus one; this is
 * unique on a single node and not across nodes yet
 * (`docs/findings/change-sets.md`, "Invoice numbers across nodes").
 */
export const invoiceNumber = (issuedOn: string, sequence: number): string =>
  `${issuedOn.slice(0, 4)}-${String(sequence).padStart(4, '0')}`;

/**
 * The stable `id` of an invoice row: the invoice number with a prefix, so
 * an `invoices` id never collides with an id of another table when both
 * appear in the same change set.
 */
export const invoiceId = (invoiceNumber: string): string =>
  `invoice-${invoiceNumber}`;

/**
 * The stable `id` of the n-th item of an invoice, counting from one.
 */
export const invoiceItemId = (
  invoiceNumber: string,
  position: number,
): string => `${invoiceId(invoiceNumber)}-item-${position}`;

/**
 * The `id` of the change set that issued an invoice, named after the
 * operation rather than the entity so that later operations on the same
 * invoice (a payment, a cancellation) can have change sets of their own.
 */
export const issueInvoiceChangeSetId = (invoiceNumber: string): string =>
  `issue-invoice-${invoiceNumber}`;
