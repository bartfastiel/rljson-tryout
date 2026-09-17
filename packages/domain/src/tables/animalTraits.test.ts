import { throwOnInvalidTableCfg } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import {
  animalTraitId,
  animalTraitsInsertHistoryTableCfg,
  animalTraitsTableCfg,
} from './animalTraits.ts';

describe('animalTraitId', () => {
  it('joins the animal id and the trait id with two dashes', () => {
    expect(animalTraitId('sir-quackington', 'fiercely-loyal')).toBe(
      'sir-quackington--fiercely-loyal',
    );
  });
});

describe('animalTraitsTableCfg', () => {
  it('is a valid rljson table configuration', () => {
    expect(() => throwOnInvalidTableCfg(animalTraitsTableCfg)).not.toThrow();
  });

  it('is a components root table keyed animalTraits', () => {
    expect(animalTraitsTableCfg).toMatchObject({
      key: 'animalTraits',
      type: 'components',
      isHead: true,
      isRoot: true,
      isShared: false,
    });
  });

  it('has the documented columns with _hash and id first', () => {
    expect(
      animalTraitsTableCfg.columns.map((column) => [column.key, column.type]),
    ).toStrictEqual([
      ['_hash', 'string'],
      ['id', 'string'],
      ['animalRef', 'string'],
      ['traitRef', 'string'],
    ]);
  });

  it('references the animals and traits tables', () => {
    const animalRefColumn = animalTraitsTableCfg.columns.find(
      (column) => column.key === 'animalRef',
    );
    const traitRefColumn = animalTraitsTableCfg.columns.find(
      (column) => column.key === 'traitRef',
    );

    expect(animalRefColumn?.ref).toStrictEqual({
      tableKey: 'animals',
      type: 'components',
    });
    expect(traitRefColumn?.ref).toStrictEqual({
      tableKey: 'traits',
      type: 'components',
    });
  });
});

describe('animalTraitsInsertHistoryTableCfg', () => {
  it('is the insertHistory companion of the animalTraits table', () => {
    expect(animalTraitsInsertHistoryTableCfg).toMatchObject({
      key: 'animalTraitsInsertHistory',
      type: 'insertHistory',
    });
    expect(() =>
      throwOnInvalidTableCfg(animalTraitsInsertHistoryTableCfg),
    ).not.toThrow();
  });

  it('references animalTraits rows through an animalTraitsRef column', () => {
    const columnKeys = animalTraitsInsertHistoryTableCfg.columns.map(
      (column) => column.key,
    );

    expect(columnKeys).toStrictEqual([
      '_hash',
      'timeId',
      'animalTraitsRef',
      'route',
      'origin',
      'previous',
      'clientTimestamp',
    ]);
  });
});
