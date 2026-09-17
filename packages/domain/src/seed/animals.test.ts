import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { animalsTableCfg } from '../tables/animals.ts';
import { breedersTableCfg } from '../tables/breeders.ts';
import { personsTableCfg } from '../tables/persons.ts';
import { speciesTableCfg } from '../tables/species.ts';
import { traitsTableCfg } from '../tables/traits.ts';
import { animalsSeed } from './animals.ts';
import { breedersSeed } from './breeders.ts';
import { personsSeed } from './persons.ts';
import { speciesSeed } from './species.ts';
import { traitsSeed } from './traits.ts';

/**
 * Builds an rljson document holding every table configuration, the species
 * seed, the traits seed, the persons seed, the breeders seed and the given
 * animal rows, wired together through `_tableCfg` on the `animals` table.
 * The validator resolves `speciesRef`, `breederRef` and every element of
 * `traitsRefs` only when the `species`, `traits` and `breeders` tables are
 * part of the same document; `breeders` in turn needs `persons` for its own
 * `personRef` to resolve.
 */
const animalsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [
      speciesTableCfg,
      traitsTableCfg,
      personsTableCfg,
      breedersTableCfg,
      animalsTableCfg,
    ],
  }),
  species: hashed({ _type: 'components', _data: [...speciesSeed] }),
  traits: hashed({ _type: 'components', _data: [...traitsSeed] }),
  persons: hashed({ _type: 'components', _data: [...personsSeed] }),
  breeders: hashed({ _type: 'components', _data: [...breedersSeed] }),
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

  it('references every seeded breeder at least once', () => {
    const referencedHashes = new Set(animalsSeed.map((row) => row.breederRef));
    const seededHashes = breedersSeed.map((row) => row._hash);

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
      ['quackmore-junior', 'Pu0o2Ogr_8w-9sA_I8RHdm'],
      ['donald-the-third', 'O60Td7HPPQAI7sQ5v8dgX3'],
      ['daphne-duck', '_2qbAzzIgo5wCZK7EfoJto'],
      ['sir-quackington', 'gmhgWXvjSF2tWIsKPNmPk0'],
      ['bowser-the-guard-dog', 'B4yKeiDryTZJG4IlykpWhw'],
      ['nosey-the-bloodhound', '__g19NBx18BkpP9iB9X3_M'],
      ['pepper-the-poodle', 'TOPCaBAq7ZRhvfFrg18R0o'],
      ['clara-cluck-junior', 'HMYG0RlL8bKOTDvbws4rgK'],
      ['gadget-the-inventor', 'R2z2I1s77nNXsDt7llTPEc'],
      ['henrietta-the-egg-champion', 'nbXemEJa6B6XjCb6um7oI-'],
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

  it('is rejected by the validator when a breederRef is dangling', async () => {
    const [firstAnimal] = animalsSeed;
    const document = animalsDocument([
      { ...rmhsh(firstAnimal), breederRef: 'no-such-breeder-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'animals', targetTable: 'breeders' }],
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
        traitsRefs: [firstAnimal.traitsRefs[0], 42, true],
      },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [
        { sourceTable: 'animals', targetTable: 'traits', targetItemHash: 42 },
        { sourceTable: 'animals', targetTable: 'traits', targetItemHash: true },
      ],
    });
  });
});
