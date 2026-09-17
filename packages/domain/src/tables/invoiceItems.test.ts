import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import {
  invoiceItemsInsertHistoryTableCfg,
  invoiceItemsTableCfg,
} from './invoiceItems.ts';

describe('invoiceItemsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(invoiceItemsTableCfg)).not.toThrow();
  });

  it('is a components root table keyed invoiceItems', () => {
    expect(invoiceItemsTableCfg).toMatchObject({
      key: 'invoiceItems',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      invoiceItemsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['invoiceRef', 'string'],
      ['animalRef', 'string'],
      ['quantity', 'number'],
      ['unitPriceCents', 'number'],
    ]);
  });

  it('declares invoiceRef and animalRef as references into their components tables', () => {
    const referenceTargets = invoiceItemsTableCfg.columns
      .filter((column) => column.ref !== undefined)
      .map((column) => [column.key, column.ref]);

    expect(referenceTargets).toStrictEqual([
      ['invoiceRef', { tableKey: 'invoices', type: 'components' }],
      ['animalRef', { tableKey: 'animals', type: 'components' }],
    ]);
  });
});

describe('invoiceItemsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the invoiceItems table', () => {
    expect(invoiceItemsInsertHistoryTableCfg).toMatchObject({
      key: 'invoiceItemsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(invoiceItemsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references invoice item rows through an invoiceItemsRef column', () => {
    const columnKeys = invoiceItemsInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'invoiceItemsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
