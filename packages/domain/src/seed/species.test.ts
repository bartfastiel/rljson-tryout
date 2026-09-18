import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import {
  speciesImageBlobId,
  speciesImageMimeType,
} from '../images/speciesImage.ts';
import { speciesTableCfg } from '../tables/species.ts';
import { speciesSeed } from './species.ts';

/**
 * Builds an rljson document holding the species table configuration and
 * the given rows, wired together through `_tableCfg`. The validator checks
 * column types only when the document carries the configuration.
 */
const speciesDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({ _type: 'tableCfgs', _data: [speciesTableCfg] }),
  species: hashed({
    _type: 'components',
    _tableCfg: hashed(speciesTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('speciesSeed', () => {
  it('holds three Duckburg species with lower-case slug ids', () => {
    expect(speciesSeed.map((row) => row.id)).toStrictEqual([
      'duck',
      'dog',
      'chicken',
    ]);
    for (const row of speciesSeed) {
      expect(row.id).toMatch(/^[a-z]+$/);
      expect(row.name).not.toBe('');
      expect(row.latinName).not.toBe('');
      expect(row.description).not.toBe('');
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(speciesSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['duck', '9eFmOk6oyayAqkBGGm0iCi'],
      ['dog', 'PmKg9tDJKn69CRX79dJmhS'],
      ['chicken', 'p_EhH-nIu-FByYeqMinCeS'],
    ]);
  });

  it('names the procedural PNG of each species as its image', () => {
    for (const row of speciesSeed) {
      expect(row.imageBlobId).toBe(speciesImageBlobId(row.id));
      expect(row.imageMimeType).toBe(speciesImageMimeType);
    }
  });

  it('validates as a species table with the rljson validator', async () => {
    const errors = await validationErrors(speciesDocument([...speciesSeed]));

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = speciesDocument([...speciesSeed]);
    const speciesTable = document.species as { _data: Json[] };
    speciesTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [duck] = speciesSeed;
    const document = speciesDocument([{ ...rmhsh(duck), latinName: 42 }]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'species', column: 'latinName' }],
    });
  });
});
