import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { speciesPool } from '../generator/speciesPool.ts';
import { generatedId } from '../generator/slug.ts';
import { decodePng } from '../testing/decodePng.ts';
import { pngSignature } from './png.ts';
import {
  speciesImage,
  speciesImageBlobId,
  speciesImageMimeType,
  speciesImageSize,
} from './speciesImage.ts';

const pixelAt = (
  image: { width: number; pixels: Uint8Array },
  x: number,
  y: number,
): number[] => [
  ...image.pixels.subarray(
    (y * image.width + x) * 4,
    (y * image.width + x) * 4 + 4,
  ),
];

describe('speciesImage', () => {
  const duck = speciesImage('duck');

  it('is a PNG', () => {
    expect([...duck.subarray(0, 8)]).toStrictEqual([...pngSignature]);
    expect(speciesImageMimeType).toBe('image/png');
  });

  it('is a decodable 256 by 256 8-bit RGBA image', () => {
    const decoded = decodePng(duck);

    expect(decoded).toMatchObject({
      width: speciesImageSize,
      height: speciesImageSize,
      bitDepth: 8,
      colourType: 6,
    });
    expect(decoded.pixels).toHaveLength(speciesImageSize ** 2 * 4);
  });

  it('paints an opaque round badge on a transparent background', () => {
    const decoded = decodePng(duck);
    const middle = speciesImageSize / 2;

    expect(pixelAt(decoded, middle, middle)[3]).toBe(255);
    expect(pixelAt(decoded, middle, 8)[3]).toBe(255);
    expect(pixelAt(decoded, 0, 0)).toStrictEqual([0, 0, 0, 0]);
    expect(pixelAt(decoded, speciesImageSize - 1, 0)).toStrictEqual([
      0, 0, 0, 0,
    ]);
    const badge = pixelAt(decoded, middle, 12);
    const face = pixelAt(decoded, middle, middle + 30);
    expect(badge).not.toStrictEqual(face);
  });

  it('stays small', () => {
    expect(duck.length).toBeLessThan(16_000);
  });

  it('is deterministic: the same id gives the same bytes, another id does not', () => {
    expect(speciesImage('duck')).toStrictEqual(duck);
    expect(speciesImage('dog')).not.toStrictEqual(duck);
    expect(speciesImage('chicken')).not.toStrictEqual(speciesImage('dog'));
  });

  it('draws every ear and face style across the seeded species', () => {
    const ids = [
      'duck',
      'dog',
      'chicken',
      ...speciesPool.map((template, index) =>
        generatedId(template.name, index + 1),
      ),
    ];
    const distinct = new Set(ids.map((id) => speciesImageBlobId(id)));

    expect(distinct.size).toBe(ids.length);
  });

  it('pins the bytes of the hand-written species, so that a change to the motif or to deflate is a deliberate seed change', () => {
    expect({
      duck: speciesImageBlobId('duck'),
      dog: speciesImageBlobId('dog'),
      chicken: speciesImageBlobId('chicken'),
    }).toMatchInlineSnapshot(`
      {
        "chicken": "3ZzWhiA8PnzfszSCjh_J9U",
        "dog": "LucQe3YAxSE6vO7R_IyBi8",
        "duck": "cZUR_CtM1HRbZkdIwhsEH9",
      }
    `);
  });
});

describe('speciesImageBlobId', () => {
  it('is the 22-character base64url prefix of the SHA-256 of the PNG, the id BsMem computes in setBlob', () => {
    const expected = createHash('sha256')
      .update(speciesImage('duck'))
      .digest('base64url')
      .slice(0, 22);

    expect(speciesImageBlobId('duck')).toBe(expected);
    expect(speciesImageBlobId('duck')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
