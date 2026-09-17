import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { breedersInsertHistoryTableCfg, breedersTableCfg } from './breeders.ts';

describe('breedersTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(breedersTableCfg)).not.toThrow();
  });

  it('is a components root table keyed breeders', () => {
    expect(breedersTableCfg).toMatchObject({
      key: 'breeders',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      breedersTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['personRef', 'string'],
      ['farmName', 'string'],
      ['suppliesSince', 'string'],
    ]);
  });

  it('declares personRef as a reference into the components persons table', () => {
    const personRef = breedersTableCfg.columns.find(
      (column) => column.key === 'personRef',
    );

    expect(personRef?.ref).toStrictEqual({
      tableKey: 'persons',
      type: 'components',
    });
  });
});

describe('breedersInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the breeders table', () => {
    expect(breedersInsertHistoryTableCfg).toMatchObject({
      key: 'breedersInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(breedersInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references breeder rows through a breedersRef column', () => {
    const columnKeys = breedersInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'breedersRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
