import { rmhsh } from '@rljson/hash';
import type { Json } from '@rljson/json';
import { BaseValidator, Validate, type Rljson } from '@rljson/rljson';
import { describe, expect, it } from 'vitest';

import { hashed } from '../hashing.ts';
import { traitsTableCfg } from '../tables/traits.ts';
import { traitsSeed } from './traits.ts';

/**
 * Builds an rljson document holding the traits table configuration and the
 * given rows, wired together through `_tableCfg`, matching the pattern
 * `species.test.ts` already uses.
 */
const traitsDocument = (rows: Json[]): Rljson => ({
  tableCfgs: hashed({ _type: 'tableCfgs', _data: [traitsTableCfg] }),
  traits: hashed({
    _type: 'components',
    _tableCfg: hashed(traitsTableCfg)._hash,
    _data: rows,
  }),
});

const validationErrors = async (document: Rljson) => {
  const validate = new Validate();
  validate.addValidator(new BaseValidator());
  return validate.run(document);
};

describe('traitsSeed', () => {
  it('holds eight to ten Duckburg-flavoured traits with lower-case, hyphenated slug ids', () => {
    expect(traitsSeed.length).toBeGreaterThanOrEqual(8);
    expect(traitsSeed.length).toBeLessThanOrEqual(10);
    const ids = new Set(traitsSeed.map((row) => row.id));
    expect(ids.size).toBe(traitsSeed.length);

    for (const row of traitsSeed) {
      expect(row.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(row.name).not.toBe('');
      expect(row.description).not.toBe('');
    }
  });

  it('has stable hashes so every node computes the same row identity', () => {
    expect(traitsSeed.map((row) => [row.id, row._hash])).toStrictEqual([
      ['hoards-shiny-objects', 'd-VfTlCpCSxZ4Ecmx9Fp9L'],
      ['chronically-unlucky', 'TLDk4RmTPAup6NtZkijMUH'],
      ['inventive', 'bllVCHqDjfaYgPi9Ehhi1E'],
      ['escapes-any-enclosure', 'NXq3Vx51rv-sqoRBZO7qBL'],
      ['fiercely-loyal', 'hgiz65QVYD0ARvN_gcBdes'],
      ['keen-senses', 'obuVGZnw3UOZpSfXYWAUi2'],
      ['competitive-streak', 'gzP2bVKgk8kJVhUjXRvVgq'],
      ['surprisingly-well-mannered', 'zel_KaaOP0jlSzYY4jAXoe'],
      ['quietly-sentimental', 'rPHMEQMk-eTJgvxIZcLpwZ'],
    ]);
  });

  it('validates as a traits table with the rljson validator', async () => {
    const errors = await validationErrors(traitsDocument([...traitsSeed]));

    expect(errors).toStrictEqual({});
  });

  it('is rejected by the validator when a row hash is tampered with', async () => {
    const document = traitsDocument([...traitsSeed]);
    const traitsTable = document.traits as { _data: Json[] };
    traitsTable._data[0]._hash = 'tampered';

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('hashesNotValid');
  });

  it('is rejected by the validator when a column has the wrong type', async () => {
    const [firstTrait] = traitsSeed;
    const document = traitsDocument([
      { ...rmhsh(firstTrait), description: 42 },
    ]);

    const errors = await validationErrors(document);

    expect(errors.base.hasErrors).toBe(true);
    expect(errors.base).toHaveProperty('dataDoesNotMatchColumnConfig');
    expect(errors.base.dataDoesNotMatchColumnConfig).toMatchObject({
      brokenValues: [{ table: 'traits', column: 'description' }],
    });
  });
});
