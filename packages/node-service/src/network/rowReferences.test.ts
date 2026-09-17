import type { TableCfg } from '@rljson/rljson';
import {
  animalsSeed,
  changeSetsTableCfg,
  hashed,
  invoicesTableCfg,
} from '@rljson-tryout/domain';
import { describe, expect, it } from 'vitest';

import { domainTableCfgs } from '../store/petShopStore.ts';
import { referencesOf } from './rowReferences.ts';

const tableCfgs: ReadonlyMap<string, TableCfg> = new Map(
  domainTableCfgs.flatMap((tableCfg) => [
    [tableCfg.key, tableCfg],
    [`${tableCfg.key}InsertHistory`, tableCfg],
  ]),
);

describe('referencesOf', () => {
  it('lists the single and the multi references of a domain row', () => {
    const animal = animalsSeed[0]!;

    expect(referencesOf(tableCfgs, 'animals', animal)).toStrictEqual({
      rows: [
        { table: 'species', hash: animal.speciesRef },
        { table: 'breeders', hash: animal.breederRef },
        ...animal.traitsRefs.map((hash) => ({ table: 'traits', hash })),
      ],
      history: [],
    });
  });

  it('lists the row and the previous versions of a history row', () => {
    const history = hashed({
      animalsRef: 'animal-hash',
      timeId: '1700000000000:abcd',
      route: '/animals',
      origin: 'db.insert',
      previous: ['1600000000000:wxyz', '1500000000000:mnop'],
    });

    expect(
      referencesOf(tableCfgs, 'animalsInsertHistory', history),
    ).toStrictEqual({
      rows: [{ table: 'animals', hash: 'animal-hash' }],
      history: [
        { table: 'animals', timeId: '1600000000000:wxyz' },
        { table: 'animals', timeId: '1500000000000:mnop' },
      ],
    });
  });

  it('lists nothing for a change set, its history row or an unknown table', () => {
    const changeSet = hashed({
      id: 'x',
      items: [{ table: invoicesTableCfg.key, ref: 'y' }],
    });
    const empty = { rows: [], history: [] };

    expect(
      referencesOf(tableCfgs, changeSetsTableCfg.key, changeSet),
    ).toStrictEqual(empty);
    expect(
      referencesOf(tableCfgs, 'changeSetsInsertHistory', {
        _hash: 'h',
        changeSetsRef: 'x',
        previous: ['1:abcd'],
      }),
    ).toStrictEqual(empty);
    expect(
      referencesOf(tableCfgs, 'nobody', { _hash: 'h', speciesRef: 'x' }),
    ).toStrictEqual(empty);
    expect(
      referencesOf(tableCfgs, 'nobodyInsertHistory', {
        _hash: 'h',
        nobodyRef: 'x',
      }),
    ).toStrictEqual(empty);
  });

  it('ignores values of the wrong shape', () => {
    expect(
      referencesOf(tableCfgs, 'animals', {
        _hash: 'h',
        speciesRef: 7,
        breederRef: null,
        traitsRefs: ['ok', 3, undefined],
      }),
    ).toStrictEqual({ rows: [{ table: 'traits', hash: 'ok' }], history: [] });
    expect(
      referencesOf(tableCfgs, 'animalsInsertHistory', {
        _hash: 'h',
        animalsRef: 5,
        previous: 'not-a-list',
      }),
    ).toStrictEqual({ rows: [], history: [] });
  });
});
