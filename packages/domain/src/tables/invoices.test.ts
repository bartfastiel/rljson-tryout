import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import {
  invoiceStatuses,
  invoicesInsertHistoryTableCfg,
  invoicesTableCfg,
} from './invoices.ts';

describe('invoicesTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(invoicesTableCfg)).not.toThrow();
  });

  it('is a components root table keyed invoices', () => {
    expect(invoicesTableCfg).toMatchObject({
      key: 'invoices',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      invoicesTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['invoiceNumber', 'string'],
      ['customerRef', 'string'],
      ['issuedOn', 'string'],
      ['status', 'string'],
    ]);
  });

  it('declares customerRef as a reference into the components customers table', () => {
    const customerRef = invoicesTableCfg.columns.find(
      (column) => column.key === 'customerRef',
    );

    expect(customerRef?.ref).toStrictEqual({
      tableKey: 'customers',
      type: 'components',
    });
  });
});

describe('invoiceStatuses', () => {
  it('names the three documented states, open first', () => {
    expect(invoiceStatuses).toStrictEqual(['open', 'paid', 'cancelled']);
  });
});

describe('invoicesInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the invoices table', () => {
    expect(invoicesInsertHistoryTableCfg).toMatchObject({
      key: 'invoicesInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(invoicesInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references invoice rows through an invoicesRef column', () => {
    const columnKeys = invoicesInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'invoicesRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
