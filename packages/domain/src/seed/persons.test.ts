import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { personsTableCfg } from '../tables/persons.ts';
import { personsSeed } from './persons.ts';

/**
 * Builds an rljson document holding the persons table configuration and the
 * given rows, wired together through `_tableCfg`, matching the pattern
 * `species.test.ts` already uses.
 */
const personsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({ _type: 'tableCfgs', _data: [personsTableCfg] }),
  persons: hashed({
    _type: 'components',
    _tableCfg: hashed(personsTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('personsSeed', () => {
  it('holds six to eight Duckburg persons with lower-case, hyphenated slug ids', () => {
    expect(personsSeed.length).toBeGreaterThanOrEqual(6);
    expect(personsSeed.length).toBeLessThanOrEqual(8);
    const ids = new Set(personsSeed.map((row) => row.id));
    expect(ids.size).toBe(personsSeed.length);

    for (const row of personsSeed) {
      expect(row.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.name).not.toBe('');
      expect(row.street).not.toBe('');
      expect(row.city).toBe('Duckburg');
      expect(row.email).toMatch(/^[^@]+@duckburg\.example$/);
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(personsSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['grandma-duck', 'XMEjEx8BvuqbPfPAWSlL_Z'],
      ['gyro-gearloose', 'RHTTFtNz3i2km4nWRfz3sA'],
      ['gladstone-gander', 'TVKSzUN4ZKGe2zx-xrS6_J'],
      ['daisy-duck', 'x0eOnSMXNFIVxmH4MvF5xn'],
      ['fethry-duck', 'f0HNDUjhA__YoZpZfVOYMO'],
      ['john-d-rockerduck', 'Fukm0QxMPwwAhxctrshrgv'],
    ]);
  });

  it('validates as a persons table with the rljson validator', async () => {
    const errors = await validationErrors(personsDocument([...personsSeed]));

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = personsDocument([...personsSeed]);
    const personsTable = document.persons as { _data: Json[] };
    personsTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [firstPerson] = personsSeed;
    const document = personsDocument([{ ...rmhsh(firstPerson), email: 42 }]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'persons', column: 'email' }],
    });
  });
});
