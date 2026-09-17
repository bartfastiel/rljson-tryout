import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { traitsInsertHistoryTableCfg, traitsTableCfg } from './traits.ts';

describe('traitsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(traitsTableCfg)).not.toThrow();
  });

  it('is a components root table keyed traits', () => {
    expect(traitsTableCfg).toMatchObject({
      key: 'traits',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented string columns with _hash and id first', () => {
    expect(
      traitsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['name', 'string'],
      ['description', 'string'],
    ]);
  });
});

describe('traitsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the traits table', () => {
    expect(traitsInsertHistoryTableCfg).toMatchObject({
      key: 'traitsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(traitsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references trait rows through a traitsRef column', () => {
    const columnKeys = traitsInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'traitsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
