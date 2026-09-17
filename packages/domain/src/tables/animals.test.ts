import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { animalsInsertHistoryTableCfg, animalsTableCfg } from './animals.ts';

describe('animalsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(animalsTableCfg)).not.toThrow();
  });

  it('is a components root table keyed animals', () => {
    expect(animalsTableCfg).toMatchObject({
      key: 'animals',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      animalsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['name', 'string'],
      ['speciesRef', 'string'],
      ['bornOn', 'string'],
      ['priceCents', 'number'],
      ['backgroundStory', 'string'],
    ]);
  });

  it('declares speciesRef as a reference into the components species table', () => {
    const speciesRef = animalsTableCfg.columns.find(
      (column) => column.key === 'speciesRef',
    );

    expect(speciesRef?.ref).toStrictEqual({
      tableKey: 'species',
      type: 'components',
    });
  });
});

describe('animalsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the animals table', () => {
    expect(animalsInsertHistoryTableCfg).toMatchObject({
      key: 'animalsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(animalsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references animal rows through an animalsRef column', () => {
    const columnKeys = animalsInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'animalsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
