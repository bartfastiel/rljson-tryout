import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { breedersTableCfg } from '../tables/breeders.ts';
import { personsTableCfg } from '../tables/persons.ts';
import { breedersSeed } from './breeders.ts';
import { personsSeed } from './persons.ts';

/**
 * Builds an rljson document holding both table configurations, the persons
 * seed and the given breeder rows, wired together through `_tableCfg` on
 * the `breeders` table. The validator resolves `personRef` only when the
 * `persons` table is part of the same document, the same pattern
 * `animals.test.ts` uses for `speciesRef`.
 */
const breedersDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [personsTableCfg, breedersTableCfg],
  }),
  persons: hashed({ _type: 'components', _data: [...personsSeed] }),
  breeders: hashed({
    _type: 'components',
    _tableCfg: hashed(breedersTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('breedersSeed', () => {
  it("holds three to four breeders with lower-case, hyphenated slug ids, Grandma Duck's farm first", () => {
    expect(breedersSeed.length).toBeGreaterThanOrEqual(3);
    expect(breedersSeed.length).toBeLessThanOrEqual(4);
    const ids = new Set(breedersSeed.map((row) => row.id));
    expect(ids.size).toBe(breedersSeed.length);
    expect(breedersSeed[0]?.farmName).toBe("Grandma Duck's Farm");

    for (const row of breedersSeed) {
      expect(row.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.farmName).not.toBe('');
      expect(row.suppliesSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(row.suppliesSince).getTime()).toBeLessThan(Date.now());
    }
  });

  it('references a seeded person for every breeder', () => {
    const personHashes = new Set(personsSeed.map((row) => row._hash));

    for (const row of breedersSeed) {
      expect(personHashes.has(row.personRef)).toBe(true);
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(breedersSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['grandma-ducks-farm', 'tPZtyJxo8PyBHCYoWhoiQL'],
      ['gearloose-workshop-hatchery', 'ntjaeuNe8sEWf2tcuEztax'],
      ['daisys-duckling-nursery', 'hCIzHpJRRuts_YPSWt3PZb'],
      ['rockerduck-kennels', 'PzGygPqV2unMLuhzWZ9vk5'],
    ]);
  });

  it('validates together with the persons table it references', async () => {
    const errors = await validationErrors(breedersDocument([...breedersSeed]));

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a personRef is dangling', async () => {
    const [firstBreeder] = breedersSeed;
    const document = breedersDocument([
      { ...rmhsh(firstBreeder), personRef: 'no-such-person-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'breeders', targetTable: 'persons' }],
    });
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = breedersDocument([...breedersSeed]);
    const breedersTable = document.breeders as { _data: Json[] };
    breedersTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [firstBreeder] = breedersSeed;
    const document = breedersDocument([
      { ...rmhsh(firstBreeder), farmName: 42 },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'breeders', column: 'farmName' }],
    });
  });
});
