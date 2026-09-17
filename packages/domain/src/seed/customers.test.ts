import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { customersTableCfg } from '../tables/customers.ts';
import { personsTableCfg } from '../tables/persons.ts';
import { breedersSeed } from './breeders.ts';
import { customersSeed } from './customers.ts';
import { personsSeed } from './persons.ts';

/**
 * Builds an rljson document holding both table configurations, the persons
 * seed and the given customer rows, wired together through `_tableCfg` on
 * the `customers` table, the same pattern `breeders.test.ts` uses.
 */
const customersDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({
    _type: 'tableCfgs',
    _data: [personsTableCfg, customersTableCfg],
  }),
  persons: hashed({ _type: 'components', _data: [...personsSeed] }),
  customers: hashed({
    _type: 'components',
    _tableCfg: hashed(customersTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('customersSeed', () => {
  it('holds five customers with lower-case, hyphenated slug ids and unique customer numbers, Scrooge first', () => {
    expect(customersSeed).toHaveLength(5);
    const ids = new Set(customersSeed.map((row) => row.id));
    expect(ids.size).toBe(customersSeed.length);
    const customerNumbers = new Set(
      customersSeed.map((row) => row.customerNumber),
    );
    expect(customerNumbers.size).toBe(customersSeed.length);
    expect(customersSeed[0]?.id).toBe('scrooge-mcduck');

    for (const row of customersSeed) {
      expect(row.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.customerNumber).toMatch(/^C-\d{4}$/);
    }
  });

  it('references a seeded person for every customer', () => {
    const personHashes = new Set(personsSeed.map((row) => row._hash));

    for (const row of customersSeed) {
      expect(personHashes.has(row.personRef)).toBe(true);
    }
  });

  it('includes a person who is also a breeder, so breeders can be customers', () => {
    const breederPersonRefs = new Set(
      breedersSeed.map((breeder) => breeder.personRef),
    );
    const customersWhoBreed = customersSeed.filter((customer) =>
      breederPersonRefs.has(customer.personRef),
    );

    expect(customersWhoBreed.map((customer) => customer.id)).toContain(
      'grandma-duck',
    );
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(customersSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['scrooge-mcduck', 'HHGlEIvZXr_7sbDtOjWIzq'],
      ['donald-duck', 'EW-g2Hoh2eum8SEqAaWU9i'],
      ['gladstone-gander', 'bvRka_0ZEflCu3vFWDHM7P'],
      ['fethry-duck', '_jaGl_Tb-L9-mH13MJXerD'],
      ['grandma-duck', 'DhSYOF7cBZHIpxiU5WXFwK'],
    ]);
  });

  it('validates together with the persons table it references', async () => {
    const errors = await validationErrors(
      customersDocument([...customersSeed]),
    );

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a personRef is dangling', async () => {
    const [firstCustomer] = customersSeed;
    const document = customersDocument([
      { ...rmhsh(firstCustomer), personRef: 'no-such-person-hash' },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('refsNotFound');
    expect(errors.base.refsNotFound).toMatchObject({
      missingRefs: [{ sourceTable: 'customers', targetTable: 'persons' }],
    });
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = customersDocument([...customersSeed]);
    const customersTable = document.customers as { _data: Json[] };
    customersTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [firstCustomer] = customersSeed;
    const document = customersDocument([
      { ...rmhsh(firstCustomer), customerNumber: 1 },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'customers', column: 'customerNumber' }],
    });
  });
});
