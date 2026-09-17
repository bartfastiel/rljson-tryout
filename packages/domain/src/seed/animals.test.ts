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

  it('gives every animal a non-empty background story, exactly one of them long', () => {
    for (const row of animalsSeed) {
      expect(row.backgroundStory.length).toBeGreaterThan(0);
    }

    const longStories = animalsSeed.filter(
      (row) => row.backgroundStory.length >= 4000,
    );
    expect(longStories).toHaveLength(1);
    expect(longStories[0]?.id).toBe('sir-quackington');
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
      ['quackmore-junior', '-5MDQMALTPIvpxjjyD43Hu'],
      ['donald-the-third', 'jppXUN_rlkoI6p7VBoxnsR'],
      ['daphne-duck', 'XgF90muWXlyTRcxVM9FceW'],
      ['sir-quackington', '22lUsKd2gaGCpcfN4EltRU'],
      ['bowser-the-guard-dog', '8nFn3JBnYkq-GM1-kSz26p'],
      ['nosey-the-bloodhound', 'caNqjP2XNKIeOza432t4cc'],
      ['pepper-the-poodle', 'jjUpNA1ELpy2xZSTjPSjK0'],
      ['clara-cluck-junior', 'jN0Hn7o-mwHmyEfusfn-Zn'],
      ['gadget-the-inventor', 'fvzZmqJeZKsoVSqkAceuZI'],
      ['henrietta-the-egg-champion', 'ogRuaRl8nR3bdna6HQ-3CG'],
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
