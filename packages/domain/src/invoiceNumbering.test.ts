import { describe, expect, it } from 'vitest';

import {
  invoiceId,
  invoiceItemId,
  invoiceNumber,
  issueInvoiceChangeSetId,
  nextInvoiceSequence,
} from './invoiceNumbering.ts';

describe('invoiceNumber', () => {
  it('combines the year of the issue date with a four digit sequence', () => {
    expect(invoiceNumber('2026-03-15', 7)).toBe('2026-0007');
  });

  it('keeps sequences beyond four digits intact', () => {
    expect(invoiceNumber('2026-12-31', 12345)).toBe('2026-12345');
  });

  it('sorts consecutive numbers of one year lexicographically in issue order', () => {
    const numbers = [1, 2, 9, 10, 11, 100, 999].map((sequence) =>
      invoiceNumber('2026-01-01', sequence),
    );

    expect([...numbers].sort()).toStrictEqual(numbers);
  });
});

describe('invoiceId, invoiceItemId and issueInvoiceChangeSetId', () => {
  it('derive readable ids from the invoice number', () => {
    expect(invoiceId('2026-0007')).toBe('invoice-2026-0007');
    expect(invoiceItemId('2026-0007', 1)).toBe('invoice-2026-0007-item-1');
    expect(invoiceItemId('2026-0007', 3)).toBe('invoice-2026-0007-item-3');
    expect(issueInvoiceChangeSetId('2026-0007')).toBe(
      'issue-invoice-2026-0007',
    );
  });
});

describe('nextInvoiceSequence', () => {
  it('starts at one for a year without invoices', () => {
    expect(nextInvoiceSequence('2026-09-17', [])).toBe(1);
    expect(nextInvoiceSequence('2027-01-01', ['2026-0001', '2026-0002'])).toBe(
      1,
    );
  });

  it('continues after the highest sequence of the year, not after the count', () => {
    expect(
      nextInvoiceSequence('2026-09-17', [
        '2026-0001',
        '2026-0007',
        '2025-0009',
      ]),
    ).toBe(8);
  });

  it('ignores the order the numbers come in', () => {
    expect(
      nextInvoiceSequence('2026-09-17', [
        '2026-0003',
        '2026-0001',
        '2026-0002',
      ]),
    ).toBe(4);
  });

  it('keeps counting beyond four digits', () => {
    expect(nextInvoiceSequence('2026-09-17', ['2026-12345'])).toBe(12346);
  });
});
