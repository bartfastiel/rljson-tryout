import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { animalsTableCfg } from '../tables/animals.ts';
import { speciesTableCfg } from '../tables/species.ts';
import { animalsSeed } from './animals.ts';
import { speciesSeed } from './species.ts';

/**
 * Builds an rljson document holding both table configurations, the species
 * seed and the given animal rows, wired together through `_tableCfg` on the
 * `animals` table. The validator resolves `speciesRef` only when the
 * `species` table is part of the same document.
 */
const animalsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [speciesTableCfg, animalsTableCfg],
  }),
  species: hashed({ _type: 'components', _data: [...speciesSeed] }),
  animals: hashed({
    _type: 'components',
    _tableCfg: hashed(animalsTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('animalsSeed', () => {
  it('holds ten Duckburg pets with lower-case, hyphenated slug ids', () => {
    expect(animalsSeed).toHaveLength(10);
    const ids = new Set(animalsSeed.map((row) => row.id));
    expect(ids.size).toBe(animalsSeed.length);

    for (const row of animalsSeed) {
      expect(row.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.name).not.toBe('');
      expect(row.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(row.priceCents)).toBe(true);
      expect(row.bornOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(row.bornOn).getTime()).toBeLessThan(Date.now());
    }
  });

  it('references every seeded species at least once', () => {
    const referencedHashes = new Set(animalsSeed.map((row) => row.speciesRef));
    const seededHashes = speciesSeed.map((row) => row._hash);

    for (const hash of seededHashes) {
      expect(referencedHashes.has(hash)).toBe(true);
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(animalsSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['quackmore-junior', '1zITQSvDFZ3iBsoRFjeak-'],
      ['donald-the-third', 'LiAgAAcHdpACS0weLkW87s'],
      ['daphne-duck', 'gkYjzI7A1eAL_tiYHG9iYU'],
      ['sir-quackington', 'ds_Q4shHXAy7roMMDRzMtS'],
      ['bowser-the-guard-dog', 'JLKaIcDNvxQlx6pFQOsU-C'],
      ['nosey-the-bloodhound', 'mu8xQHtvn8SARkwkaNZ1pl'],
      ['pepper-the-poodle', 'oOgAZp6jsAfjDbL06oW91u'],
      ['clara-cluck-junior', '6xwivtJjwqpdwsoqU0Wr8k'],
      ['gadget-the-inventor', '3I50HlU10DUOcI0O7PI511'],
      ['henrietta-the-egg-champion', 'QuW0VMHONHxuojLFssww61'],
    ]);
  });

  it('validates together with the species table it references', async () => {
    const errors = await validationErrors(animalsDocument([...animalsSeed]));

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a speciesRef is dangling', async () => {
    const [firstAnimal] = animalsSeed;
    const document = animalsDocument([
      { ...rmhsh(firstAnimal), speciesRef: 'no-such-species-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'animals', targetTable: 'species' }],
    });
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [firstAnimal] = animalsSeed;
    const document = animalsDocument([
      { ...rmhsh(firstAnimal), priceCents: 'not a number' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'animals', column: 'priceCents' }],
    });
  });
});
