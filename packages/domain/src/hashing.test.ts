import { describe, expect, it } from 'vitest';

import { hashMatches, hashed } from './hashing.ts';

describe('hashed', () => {
  it('adds a deterministic hash and leaves the input unchanged', () => {
    const input = { a: 1 };

    const result = hashed(input);

    expect(result._hash).toBe('AVq9f1zFei3ZS3WQ8ErYCE');
    expect(input).toStrictEqual({ a: 1 });
  });
});

describe('hashMatches', () => {
  it('accepts a value whose hash is the hash of its content', () => {
    const row = hashed({ id: 'x', items: [{ table: 't', ref: 'r' }] });

    expect(hashMatches(row)).toBe(true);
    expect(row).toStrictEqual(
      hashed({ id: 'x', items: [{ table: 't', ref: 'r' }] }),
    );
  });

  it('rejects a value whose content changed after hashing', () => {
    const row = hashed({ id: 'x', name: 'Bowser' });

    expect(hashMatches({ ...row, name: 'Fluffy' })).toBe(false);
  });

  it('rejects a value whose own hash was replaced', () => {
    const row = hashed({ id: 'x', name: 'Bowser' });

    expect(hashMatches({ ...row, _hash: 'AVq9f1zFei3ZS3WQ8ErYCE' })).toBe(
      false,
    );
  });

  it('rejects a value with a tampered element of a list', () => {
    const row = hashed({ id: 'x', items: [{ table: 't', ref: 'r' }] });
    const tampered = {
      ...row,
      items: [{ ...row.items[0]!, ref: 'somebody-else' }],
    };

    expect(hashMatches(tampered)).toBe(false);
  });

  it('rejects a value that cannot be hashed', () => {
    expect(hashMatches({ _hash: 'x', value: Number.NaN })).toBe(false);
  });
});
