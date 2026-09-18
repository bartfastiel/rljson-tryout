import { pngSignature } from './png.ts';

/**
 * The media types a species image may be uploaded as
 * (`POST /api/species/:id/image`, roadmap slice D5): what a phone camera
 * produces and what every browser renders.
 */
export const uploadedImageMediaTypes = ['image/png', 'image/jpeg'] as const;

export type UploadedImageMediaType = (typeof uploadedImageMediaTypes)[number];

/**
 * The most bytes an uploaded species image may have: one mebibyte, plenty
 * for a card-sized photo and small enough that a blob travels between the
 * nodes in one socket message without a second thought.
 */
export const maximumUploadedImageBytes = 1024 * 1024;

/** The three bytes every JPEG file starts with (`SOI` plus a marker). */
const jpegSignature: Uint8Array = Uint8Array.of(0xff, 0xd8, 0xff);

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length &&
  prefix.every((byte, index) => bytes[index] === byte);

/**
 * The media type the first bytes of an upload say it is: a PNG by its
 * eight-byte signature, a JPEG by its start-of-image marker, `null` for
 * anything else. The declared `Content-Type` of a request is what the
 * sender claims; these bytes are what the sender sent, and only they
 * decide (an HTML page uploaded as `image/png` is refused, a JPEG declared
 * as PNG too).
 */
export const detectedImageMediaType = (
  bytes: Uint8Array,
): UploadedImageMediaType | null => {
  if (startsWith(bytes, pngSignature)) {
    return 'image/png';
  }
  if (startsWith(bytes, jpegSignature)) {
    return 'image/jpeg';
  }
  return null;
};

export const isUploadedImageMediaType = (
  value: string,
): value is UploadedImageMediaType =>
  (uploadedImageMediaTypes as readonly string[]).includes(value);

/**
 * The `id` of the change set that writes a new species version with an
 * uploaded image (roadmap section 3.4), after the pattern of
 * `updateAnimalChangeSetId`: the species and the `timeId` of the new
 * version's InsertHistory row.
 */
export const updateSpeciesImageChangeSetId = (
  speciesId: string,
  timeId: string,
): string => `update-species-image-${speciesId}-${timeId}`;
