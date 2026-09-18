import { constants, crc32, deflateSync } from 'node:zlib';

/**
 * An image as the rasterizer produces it and the encoder takes it: 8-bit
 * RGBA, four bytes per pixel, rows top to bottom, not premultiplied.
 */
export type RgbaImage = Readonly<{
  width: number;
  height: number;
  pixels: Uint8Array;
}>;

/** The eight bytes every PNG file starts with. */
export const pngSignature: Uint8Array = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);

const bytesPerPixel = 4;
const bitDepth = 8;
const colourTypeRgba = 6;

/**
 * The PNG filter every row is written with: `Sub`, each byte minus the
 * byte one pixel to its left. Flat areas of an image then become runs of
 * zero bytes, which is what the run-length deflate below compresses.
 */
const subFilter = 1;

const encoder = new TextEncoder();

/**
 * One PNG chunk: its length, its four-character type, its data and the
 * CRC-32 over type and data.
 */
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(encoder.encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
};

const imageHeader = (image: RgbaImage): Uint8Array => {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  data[8] = bitDepth;
  data[9] = colourTypeRgba;
  return data;
};

/**
 * The image rows with their filter byte, each row `Sub`-filtered: the
 * scanline data deflate compresses into the `IDAT` chunk.
 */
const filteredScanlines = (image: RgbaImage): Uint8Array => {
  const stride = image.width * bytesPerPixel;
  const scanlines = new Uint8Array(image.height * (1 + stride));
  for (let row = 0; row < image.height; row += 1) {
    const source = row * stride;
    const target = row * (1 + stride);
    scanlines[target] = subFilter;
    for (let offset = 0; offset < stride; offset += 1) {
      const left =
        offset < bytesPerPixel
          ? 0
          : image.pixels[source + offset - bytesPerPixel];
      scanlines[target + 1 + offset] =
        (image.pixels[source + offset] - left) & 0xff;
    }
  }
  return scanlines;
};

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

/**
 * Encodes an RGBA image as a PNG file: signature, `IHDR`, one `IDAT` and
 * `IEND`. The scanlines are compressed with deflate in run-length mode
 * (`Z_RLE`): it only ever matches a byte against the byte before it, so
 * unlike the default strategy it uses none of the CPU-specific match
 * finders of Node's zlib and produces the same bytes for the same image on
 * every machine. That matters here because the blob id of an image, and
 * with it the hash of the species row that names it, is computed from
 * these bytes on every node (`docs/findings/blobs.md`).
 */
export const encodePng = (image: RgbaImage): Uint8Array => {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1
  ) {
    throw new RangeError(
      `A PNG needs a positive integer width and height, got ${image.width} by ${image.height}.`,
    );
  }
  const expectedLength = image.width * image.height * bytesPerPixel;
  if (image.pixels.length !== expectedLength) {
    throw new RangeError(
      `A ${image.width} by ${image.height} RGBA image needs ${expectedLength} bytes, got ${image.pixels.length}.`,
    );
  }
  const compressed = deflateSync(filteredScanlines(image), {
    strategy: constants.Z_RLE,
  });
  return concatenate([
    pngSignature,
    chunk('IHDR', imageHeader(image)),
    chunk('IDAT', new Uint8Array(compressed)),
    chunk('IEND', new Uint8Array(0)),
  ]);
};
