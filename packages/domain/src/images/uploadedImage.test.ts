import { describe, expect, it } from 'vitest';

import { encodePng, pngSignature } from './png.ts';
import { speciesImage } from './speciesImage.ts';
import {
  detectedImageMediaType,
  isUploadedImageMediaType,
  maximumUploadedImageBytes,
  updateSpeciesImageChangeSetId,
  uploadedImageMediaTypes,
} from './uploadedImage.ts';

/** The smallest JPEG prefix a camera writes: SOI followed by an APP0 marker. */
const jpegStart = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a);

describe('detectedImageMediaType', () => {
  it('recognises a PNG by its signature', () => {
    expect(detectedImageMediaType(speciesImage('duck'))).toBe('image/png');
    expect(
      detectedImageMediaType(
        encodePng({ width: 1, height: 1, pixels: Uint8Array.of(1, 2, 3, 4) }),
      ),
    ).toBe('image/png');
  });

  it('recognises a JPEG by its start-of-image marker', () => {
    expect(detectedImageMediaType(jpegStart)).toBe('image/jpeg');
  });

  it('answers null for bytes that are neither', () => {
    expect(detectedImageMediaType(new Uint8Array(0))).toBeNull();
    expect(detectedImageMediaType(pngSignature.subarray(0, 7))).toBeNull();
    expect(
      detectedImageMediaType(new TextEncoder().encode('<!doctype html>')),
    ).toBeNull();
    expect(detectedImageMediaType(Uint8Array.of(0xff, 0xd8, 0x00))).toBeNull();
    expect(detectedImageMediaType(Uint8Array.of(0x47, 0x49, 0x46, 0x38))).toBe(
      null,
    );
  });
});

describe('isUploadedImageMediaType', () => {
  it('accepts exactly the two media types an upload may declare', () => {
    expect(uploadedImageMediaTypes).toStrictEqual(['image/png', 'image/jpeg']);
    for (const mediaType of uploadedImageMediaTypes) {
      expect(isUploadedImageMediaType(mediaType)).toBe(true);
    }
    expect(isUploadedImageMediaType('image/webp')).toBe(false);
    expect(isUploadedImageMediaType('image/jpg')).toBe(false);
    expect(isUploadedImageMediaType('')).toBe(false);
  });
});

describe('maximumUploadedImageBytes', () => {
  it('is one mebibyte', () => {
    expect(maximumUploadedImageBytes).toBe(1_048_576);
  });
});

describe('updateSpeciesImageChangeSetId', () => {
  it('names the species and the time id of the new version', () => {
    expect(updateSpeciesImageChangeSetId('duck', '1789654560429:vqqc')).toBe(
      'update-species-image-duck-1789654560429:vqqc',
    );
  });
});
