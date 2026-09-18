import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { speciesInsertHistoryTableCfg, speciesTableCfg } from './species.ts';

describe('speciesTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(speciesTableCfg)).not.toThrow();
  });

  it('is a components root table keyed species', () => {
    expect(speciesTableCfg).toMatchObject({
      key: 'species',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented string columns with _hash and id first', () => {
    expect(
      speciesTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['name', 'string'],
      ['latinName', 'string'],
      ['description', 'string'],
      ['imageBlobId', 'string'],
      ['imageMimeType', 'string'],
    ]);
  });
});

describe('speciesInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the species table', () => {
    expect(speciesInsertHistoryTableCfg).toMatchObject({
      key: 'speciesInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(speciesInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references species rows through a speciesRef column', () => {
    const columnKeys = speciesInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'speciesRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
