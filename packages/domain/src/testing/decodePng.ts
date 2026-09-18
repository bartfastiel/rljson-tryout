import { crc32, inflateSync } from 'node:zlib';

import { pngSignature, type RgbaImage } from '../images/png.ts';

/**
 * What the test decoder reads out of a PNG file: the header fields the
 * tests assert and the unfiltered RGBA pixels.
 */
export type DecodedPng = RgbaImage &
  Readonly<{
    bitDepth: number;
    colourType: number;
    chunkTypes: readonly string[];
  }>;

type Chunk = { type: string; data: Uint8Array };

const decoder = new TextDecoder();

const readChunks = (bytes: Uint8Array): Chunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = pngSignature.length;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    const storedCrc = view.getUint32(offset + 8 + length);
    if (storedCrc !== expectedCrc) {
      throw new Error(`The CRC of the ${type} chunk does not match.`);
    }
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
};

/**
 * Reads back a PNG the encoder wrote, for the tests that must prove the
 * files are what they claim to be: the signature, every chunk's CRC, the
 * header, and the `IDAT` inflated and unfiltered (`None` and `Sub`, the
 * two filters this project's encoder can emit) into RGBA pixels. Not a
 * general PNG reader: interlacing, palettes and other bit depths are
 * refused.
 */
export const decodePng = (bytes: Uint8Array): DecodedPng => {
  if (!pngSignature.every((byte, index) => bytes[index] === byte)) {
    throw new Error('The bytes do not start with the PNG signature.');
  }
  const chunks = readChunks(bytes);
  const header = chunks.find((chunk) => chunk.type === 'IHDR');
  if (header === undefined) {
    throw new Error('The PNG has no IHDR chunk.');
  }
  const headerView = new DataView(
    header.data.buffer,
    header.data.byteOffset,
    header.data.byteLength,
  );
  const width = headerView.getUint32(0);
  const height = headerView.getUint32(4);
  const bitDepth = header.data[8];
  const colourType = header.data[9];
  if (bitDepth !== 8 || colourType !== 6 || header.data[12] !== 0) {
    throw new Error(
      'The test decoder only reads non-interlaced 8-bit RGBA images.',
    );
  }
  const scanlines = new Uint8Array(
    inflateSync(
      Buffer.concat(
        chunks
          .filter((chunk) => chunk.type === 'IDAT')
          .map((chunk) => chunk.data),
      ),
    ),
  );
  const stride = width * 4;
  if (scanlines.length !== height * (1 + stride)) {
    throw new Error(
      `Expected ${height * (1 + stride)} scanline bytes, got ${scanlines.length}.`,
    );
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const filter = scanlines[row * (1 + stride)];
    if (filter !== 0 && filter !== 1) {
      throw new Error(`Row ${row} uses the unsupported filter ${filter}.`);
    }
    for (let offset = 0; offset < stride; offset += 1) {
      const left =
        filter === 1 && offset >= 4 ? pixels[row * stride + offset - 4] : 0;
      pixels[row * stride + offset] =
        (scanlines[row * (1 + stride) + 1 + offset] + left) & 0xff;
    }
  }
  return {
    width,
    height,
    bitDepth,
    colourType,
    chunkTypes: chunks.map((chunk) => chunk.type),
    pixels,
  };
};
