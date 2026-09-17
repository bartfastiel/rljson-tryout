import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { animalTraitsTableCfg } from '../tables/animalTraits.ts';
import { animalsTableCfg } from '../tables/animals.ts';
import { traitsTableCfg } from '../tables/traits.ts';
import { animalsSeed } from './animals.ts';
import { animalTraitsSeed } from './animalTraits.ts';
import { traitsSeed } from './traits.ts';

/**
 * Builds an rljson document holding every table configuration, the animals
 * seed, the traits seed and the given `animalTraits` rows, wired together
 * through `_tableCfg` on the `animalTraits` table. The validator resolves
 * `animalRef` and `traitRef` only when the `animals` and `traits` tables are
 * part of the same document (`docs/findings/db-basics.md`, "Joining a
 * reference").
 */
const animalTraitsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [animalsTableCfg, traitsTableCfg, animalTraitsTableCfg],
  }),
  animals: hashed({ _type: 'components', _data: [...animalsSeed] }),
  traits: hashed({ _type: 'components', _data: [...traitsSeed] }),
  animalTraits: hashed({
    _type: 'components',
    _tableCfg: hashed(animalTraitsTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('animalTraitsSeed', () => {
  it('holds one row per entry of every seeded animal traitsRefs', () => {
    const expectedCount = animalsSeed.reduce(
      (sum, animal) => sum + animal.traitsRefs.length,
      0,
    );

    expect(expectedCount).toBeGreaterThan(0);
    expect(animalTraitsSeed).toHaveLength(expectedCount);
  });

  it('gives every row a deterministic <animalId>--<traitId> id', () => {
    const byHash = new Map(traitsSeed.map((trait) => [trait._hash, trait]));

    for (const animal of animalsSeed) {
      for (const traitRef of animal.traitsRefs) {
        const trait = byHash.get(traitRef);
        expect(trait).toBeDefined();

        const row = animalTraitsSeed.find(
          (candidate) =>
            candidate.animalRef === animal._hash &&
            candidate.traitRef === traitRef,
        );
        expect(row).toBeDefined();
        expect(row!.id).toBe(`${animal.id}--${trait!.id}`);
      }
    }
  });

  it('has unique row ids', () => {
    const ids = animalTraitsSeed.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the animals and traits seeds untouched while deriving', () => {
    const animalsBefore = structuredClone(animalsSeed);
    const traitsBefore = structuredClone(traitsSeed);

    expect(animalTraitsSeed.length).toBeGreaterThan(0);

    expect(animalsSeed).toStrictEqual(animalsBefore);
    expect(traitsSeed).toStrictEqual(traitsBefore);
  });

  it('validates together with the animals and traits tables it references', async () => {
    const errors = await validationErrors(
      animalTraitsDocument([...animalTraitsSeed]),
    );

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when an animalRef is dangling', async () => {
    const [firstRow] = animalTraitsSeed;
    const document = animalTraitsDocument([
      { ...rmhsh(firstRow), animalRef: 'no-such-animal-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'animalTraits', targetTable: 'animals' }],
    });
  });

  it('is rejected by the validator when a traitRef is dangling', async () => {
    const [firstRow] = animalTraitsSeed;
    const document = animalTraitsDocument([
      { ...rmhsh(firstRow), traitRef: 'no-such-trait-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'animalTraits', targetTable: 'traits' }],
    });
  });
});
