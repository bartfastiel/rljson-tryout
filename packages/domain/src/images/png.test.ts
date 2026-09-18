import { describe, expect, it } from 'vitest';

import { decodePng } from '../testing/decodePng.ts';
import { encodePng, pngSignature, type RgbaImage } from './png.ts';

/**
 * A 3 by 2 image with a distinct colour per pixel and one fully
 * transparent pixel, small enough to compare byte for byte.
 */
const sampleImage: RgbaImage = {
  width: 3,
  height: 2,
  pixels: Uint8Array.of(
    255,
    0,
    0,
    255,
    0,
    255,
    0,
    255,
    0,
    0,
    255,
    255,
    10,
    20,
    30,
    40,
    0,
    0,
    0,
    0,
    200,
    200,
    200,
    128,
  ),
};

describe('encodePng', () => {
  const bytes = encodePng(sampleImage);

  it('starts with the PNG signature', () => {
    expect([...bytes.subarray(0, 8)]).toStrictEqual([...pngSignature]);
    expect([...pngSignature]).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it('writes IHDR, one IDAT and IEND with matching CRCs', () => {
    expect(decodePng(bytes).chunkTypes).toStrictEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares the size, 8 bits per channel and the RGBA colour type in IHDR', () => {
    const decoded = decodePng(bytes);

    expect(decoded).toMatchObject({
      width: 3,
      height: 2,
      bitDepth: 8,
      colourType: 6,
    });
  });

  it('round-trips every pixel through deflate and the Sub filter', () => {
    expect([...decodePng(bytes).pixels]).toStrictEqual([...sampleImage.pixels]);
  });

  it('is deterministic: the same image gives the same bytes', () => {
    expect(encodePng(sampleImage)).toStrictEqual(bytes);
  });

  it('is rejected when a CRC is tampered with', () => {
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decodePng(tampered)).toThrow(/CRC of the IEND chunk/);
  });

  it('compresses a flat image to a fraction of its raw size', () => {
    const width = 256;
    const height = 256;
    const pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([120, 80, 200, 255], index);
    }

    const flat = encodePng({ width, height, pixels });

    expect(flat.length).toBeLessThan(2_000);
    expect([...decodePng(flat).pixels.subarray(0, 4)]).toStrictEqual([
      120, 80, 200, 255,
    ]);
  });

  it('refuses an empty or fractional size', () => {
    expect(() =>
      encodePng({ width: 0, height: 1, pixels: new Uint8Array(0) }),
    ).toThrow(RangeError);
    expect(() =>
      encodePng({ width: 1.5, height: 1, pixels: new Uint8Array(6) }),
    ).toThrow(RangeError);
  });

  it('refuses a pixel buffer that does not match the size', () => {
    expect(() =>
      encodePng({ width: 2, height: 2, pixels: new Uint8Array(15) }),
    ).toThrow(/needs 16 bytes, got 15/);
  });
});
