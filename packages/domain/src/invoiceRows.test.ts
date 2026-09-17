import { describe, expect, it } from 'vitest';

import { hashed } from './hashing.ts';
import { invoiceRows, type InvoiceDraft } from './invoiceRows.ts';

const draft: InvoiceDraft = {
  invoiceNumber: '2026-0007',
  customerRef: 'customer-hash',
  issuedOn: '2026-09-17',
  status: 'open',
  lines: [
    { animal: { _hash: 'animal-a', priceCents: 12_000 }, quantity: 1 },
    { animal: { _hash: 'animal-b', priceCents: 500 }, quantity: 3 },
  ],
};

describe('invoiceRows', () => {
  it('builds the invoice row and one item per line in line order', () => {
    const { invoice, items } = invoiceRows(draft);

    expect(invoice).toStrictEqual(
      hashed({
        id: 'invoice-2026-0007',
        invoiceNumber: '2026-0007',
        customerRef: 'customer-hash',
        issuedOn: '2026-09-17',
        status: 'open',
      }),
    );
    expect(items).toStrictEqual([
      hashed({
        id: 'invoice-2026-0007-item-1',
        invoiceRef: invoice._hash,
        animalRef: 'animal-a',
        quantity: 1,
        unitPriceCents: 12_000,
      }),
      hashed({
        id: 'invoice-2026-0007-item-2',
        invoiceRef: invoice._hash,
        animalRef: 'animal-b',
        quantity: 3,
        unitPriceCents: 500,
      }),
    ]);
  });

  it('hashes the same draft the same way every time', () => {
    const first = invoiceRows(draft);
    const second = invoiceRows({ ...draft, lines: [...draft.lines] });

    expect(second.invoice._hash).toBe(first.invoice._hash);
    expect(second.items.map((item) => item._hash)).toStrictEqual(
      first.items.map((item) => item._hash),
    );
  });

  it('leaves a draft without lines with an invoice and no items', () => {
    expect(invoiceRows({ ...draft, lines: [] }).items).toStrictEqual([]);
  });
});
