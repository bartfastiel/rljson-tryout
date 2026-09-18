import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { blobIdOf } from './blobId.ts';

describe('blobIdOf', () => {
  it('is the 22-character base64url prefix of the SHA-256 of the bytes', () => {
    const bytes = new TextEncoder().encode('hello');

    expect(blobIdOf(bytes)).toBe('LPJNul-wow4m6Dsqxbninh');
    expect(blobIdOf(bytes)).toBe(
      createHash('sha256').update(bytes).digest('base64url').slice(0, 22),
    );
  });

  it('changes with a single byte', () => {
    expect(blobIdOf(Uint8Array.of(1, 2, 3))).not.toBe(
      blobIdOf(Uint8Array.of(1, 2, 4)),
    );
  });
});
