import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import {
  customersInsertHistoryTableCfg,
  customersTableCfg,
} from './customers.ts';

describe('customersTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(customersTableCfg)).not.toThrow();
  });

  it('is a components root table keyed customers', () => {
    expect(customersTableCfg).toMatchObject({
      key: 'customers',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      customersTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['personRef', 'string'],
      ['customerNumber', 'string'],
    ]);
  });

  it('declares personRef as a reference into the components persons table', () => {
    const personRef = customersTableCfg.columns.find(
      (column) => column.key === 'personRef',
    );

    expect(personRef?.ref).toStrictEqual({
      tableKey: 'persons',
      type: 'components',
    });
  });
});

describe('customersInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the customers table', () => {
    expect(customersInsertHistoryTableCfg).toMatchObject({
      key: 'customersInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(customersInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references customer rows through a customersRef column', () => {
    const columnKeys = customersInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'customersRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
