import { hashed } from './hashing.ts';
import { invoiceId, invoiceItemId } from './invoiceNumbering.ts';
import type { HashedInvoiceItemRow } from './tables/invoiceItems.ts';
import type { HashedInvoiceRow, InvoiceStatus } from './tables/invoices.ts';

/**
 * One line of an invoice before it is written: the animal version sold
 * (its `_hash` becomes `animalRef`, its `priceCents` the unit price) and
 * how many.
 */
export type InvoiceLine = {
  animal: { _hash: string; priceCents: number };
  quantity: number;
};

/**
 * Everything that decides the rows of one invoice: its number, the
 * customer version it is issued to, the issue date, the status and the
 * lines. Whoever holds these values can compute the rows, and with them
 * the hashes, without a store.
 */
export type InvoiceDraft = {
  invoiceNumber: string;
  customerRef: string;
  issuedOn: string;
  status: InvoiceStatus;
  lines: readonly InvoiceLine[];
};

export type InvoiceRows = {
  invoice: HashedInvoiceRow;
  items: HashedInvoiceItemRow[];
};

/**
 * The `invoices` row and the `invoiceItems` rows of one invoice, hashed,
 * exactly as the store writes them: `id` from the number, one item per
 * line in line order with `invoiceItemId(number, position)`, the item's
 * `unitPriceCents` copied from the animal. One builder for the invoices
 * issued through the API, the hand-written seed and the generated seed,
 * so that the same draft hashes the same wherever it is turned into rows.
 */
export const invoiceRows = (draft: InvoiceDraft): InvoiceRows => {
  const invoice = hashed({
    id: invoiceId(draft.invoiceNumber),
    invoiceNumber: draft.invoiceNumber,
    customerRef: draft.customerRef,
    issuedOn: draft.issuedOn,
    status: draft.status,
  });
  const items = draft.lines.map((line, index) =>
    hashed({
      id: invoiceItemId(draft.invoiceNumber, index + 1),
      invoiceRef: invoice._hash,
      animalRef: line.animal._hash,
      quantity: line.quantity,
      unitPriceCents: line.animal.priceCents,
    }),
  );

  return { invoice, items };
};
