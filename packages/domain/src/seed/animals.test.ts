import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { animalsTableCfg } from '../tables/animals.ts';
import { speciesTableCfg } from '../tables/species.ts';
import { traitsTableCfg } from '../tables/traits.ts';
import { animalsSeed } from './animals.ts';
import { speciesSeed } from './species.ts';
import { traitsSeed } from './traits.ts';

/**
 * Builds an rljson document holding every table configuration, the species
 * seed, the traits seed and the given animal rows, wired together through
 * `_tableCfg` on the `animals` table. The validator resolves `speciesRef`
 * and every element of `traitsRefs` only when the `species` and `traits`
 * tables are part of the same document.
 */
const animalsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [speciesTableCfg, traitsTableCfg, animalsTableCfg],
  }),
  species: hashed({ _type: 'components', _data: [...speciesSeed] }),
  traits: hashed({ _type: 'components', _data: [...traitsSeed] }),
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

  it('gives every animal one to four traits, referencing every seeded trait at least once', () => {
    for (const row of animalsSeed) {
      expect(row.traitsRefs.length).toBeGreaterThanOrEqual(1);
      expect(row.traitsRefs.length).toBeLessThanOrEqual(4);
      expect(new Set(row.traitsRefs).size).toBe(row.traitsRefs.length);
    }

    const referencedHashes = new Set(
      animalsSeed.flatMap((row) => row.traitsRefs),
    );
    const seededHashes = traitsSeed.map((row) => row._hash);

    for (const hash of seededHashes) {
      expect(referencedHashes.has(hash)).toBe(true);
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(animalsSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['quackmore-junior', 'UTRZvMtThFpV0fN0rT3JJg'],
      ['donald-the-third', 'UasrtSDCUYnmRTIIrLBSAR'],
      ['daphne-duck', 'g-TZPnqomCtltXDPlbf1uV'],
      ['sir-quackington', 'UXvLUGWJCFBtgVodNciRCa'],
      ['bowser-the-guard-dog', 'WUeB7ZWkQFN9H-VhRaGwv7'],
      ['nosey-the-bloodhound', 'Zpip4Yi-pKgOOmiwjBP5ph'],
      ['pepper-the-poodle', 'TsYFL52G5C96XVDIfSBMkS'],
      ['clara-cluck-junior', 'IBmVaFO325a3TfQ7YjbNiY'],
      ['gadget-the-inventor', 'bFxMulCfFrybBOsFuimRnk'],
      ['henrietta-the-egg-champion', 'rT48w8at5UbnAQrkH4OoTl'],
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

  /**
   * The acceptance criterion of slice B5: a dangling hash inside the
   * `jsonArray` multi-reference `traitsRefs` must be rejected. Nothing in
   * `domain` adds a check for this; rljson's own `BaseValidator` already
   * walks every element of an array-valued `ref` column and resolves each
   * one against the target table, exactly as it does for a single-valued
   * `ref` column such as `speciesRef` above (`docs/findings/db-basics.md`,
   * "Multi-references"), so this test only has to prove the built-in
   * behaviour holds for this table.
   */
  it('is rejected by the validator when a traitsRefs entry is dangling', async () => {
    const [firstAnimal] = animalsSeed;
    const document = animalsDocument([
      {
        ...rmhsh(firstAnimal),
        traitsRefs: [firstAnimal.traitsRefs[0], 'no-such-trait-hash'],
      },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'animals', targetTable: 'traits' }],
    });
  });

  /**
   * rljson's `dataDoesNotMatchColumnConfig` check only confirms that
   * `traitsRefs` as a whole is an array (`jsonValueMatchesType` treats every
   * array as type `jsonArray` regardless of what it holds, per
   * `node_modules/@rljson/json`); it never looks at the type of an
   * individual element. A non-string element is still rejected in practice,
   * though: `_refsNotFound` looks each array element up as a hash against
   * the `traits` table, and a number or a boolean never equals a stored
   * hash, so it is reported the same way a dangling string hash is, as a
   * broken reference rather than a type mismatch
   * (`docs/findings/db-basics.md`, "Multi-references").
   */
  it('is rejected by the validator when a traitsRefs entry has the wrong type', async () => {
    const [firstAnimal] = animalsSeed;
    const document = animalsDocument([
      {
        ...rmhsh(firstAnimal),
        traitsRefs: [firstAnimal.traitsRefs[0], 42],
      },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [
        { sourceTable: 'animals', targetTable: 'traits', targetItemHash: 42 },
      ],
    });
  });
});
