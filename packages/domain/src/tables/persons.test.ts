import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { personsInsertHistoryTableCfg, personsTableCfg } from './persons.ts';

describe('personsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(personsTableCfg)).not.toThrow();
  });

  it('is a components root table keyed persons', () => {
    expect(personsTableCfg).toMatchObject({
      key: 'persons',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented string columns with _hash and id first', () => {
    expect(
      personsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['name', 'string'],
      ['street', 'string'],
      ['city', 'string'],
      ['email', 'string'],
    ]);
  });
});

describe('personsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the persons table', () => {
    expect(personsInsertHistoryTableCfg).toMatchObject({
      key: 'personsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(personsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references person rows through a personsRef column', () => {
    const columnKeys = personsInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'personsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
