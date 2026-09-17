import { describe, expect, it } from 'vitest';

import { hashed } from './hashing.ts';

describe('hashed', () => {
  it('adds a deterministic hash and leaves the input unchanged', () => {
    const input = { a: 1 };

    const result = hashed(input);

    expect(result._hash).toBe('AVq9f1zFei3ZS3WQ8ErYCE');
    expect(input).toStrictEqual({ a: 1 });
  });
});
