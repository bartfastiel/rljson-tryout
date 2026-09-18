import {
  blobIdOf,
  hashed,
  maximumUploadedImageBytes,
  pngSignature,
  speciesImage,
  speciesSeed,
  speciesTableCfg,
  type SpeciesRow,
} from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PetShopStore } from '../store/petShopStore.ts';
import { buildTestServer } from '../testing/testServer.ts';
import { memoryStore } from '../testing/testStores.ts';

type SpeciesResponse = {
  id: string;
  hash: string;
  name: string;
  latinName: string;
  description: string;
  imageUrl: string;
};

const [duck] = speciesSeed;

/** A JPEG start, what a phone camera's file begins with. */
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

describe('GET /api/species', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('answers with an empty list when nothing is seeded', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual([]);
  });

  it('lists the three seeded species in the documented shape', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const species = response.json<Record<string, string>[]>();
    expect(species).toHaveLength(3);
    for (const entry of species) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'description',
        'hash',
        'id',
        'imageUrl',
        'latinName',
        'name',
      ]);
      expect(entry.imageUrl).toBe(`/api/species/${entry.hash}/image`);
    }
  });

  it('returns the row hash of every species as hash', async () => {
    await store.seedIfEmpty();

    const response = await server.inject({
      method: 'GET',
      url: '/api/species',
    });

    const species = response.json<{ id: string; hash: string }[]>();
    const expected = [...speciesSeed]
      .map((row) => ({ id: row.id, hash: row._hash }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(species.map(({ id, hash }) => ({ id, hash }))).toStrictEqual(
      expected,
    );
  });
});

describe('GET /api/species/:hash/image', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    await store.seedIfEmpty();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  it('serves the PNG of a species version with an immutable cache header', async () => {
    const [duck] = speciesSeed;

    const response = await server.inject({
      method: 'GET',
      url: `/api/species/${duck._hash}/image`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect([...response.rawPayload.subarray(0, 8)]).toStrictEqual([
      ...pngSignature,
    ]);
    expect(response.rawPayload).toStrictEqual(
      Buffer.from(speciesImage(duck.id)),
    );
  });

  it('serves the image the list links to', async () => {
    const listed = (
      await server.inject({ method: 'GET', url: '/api/species' })
    ).json<{ imageUrl: string }[]>();

    for (const { imageUrl } of listed) {
      const response = await server.inject({ method: 'GET', url: imageUrl });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    }
  });

  it('answers 404 for a hash no species version has', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/species/NoSuchSpeciesVersion00/image',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No species version with hash "NoSuchSpeciesVersion00".',
    });
  });

  it('answers 404 with a clear message for a version whose image no node holds', async () => {
    const received = hashed({
      id: 'duck',
      name: duck.name,
      latinName: duck.latinName,
      description: duck.description,
      imageBlobId: 'UploadedElsewhere00000',
      imageMimeType: 'image/jpeg',
    } satisfies SpeciesRow);
    await store.writeReceivedRows([
      { table: speciesTableCfg.key, row: received },
    ]);

    const response = await server.inject({
      method: 'GET',
      url: `/api/species/${received._hash}/image`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: `The image of species version "${received._hash}" (blob UploadedElsewhere00000) is held neither by this node nor by any node it could ask: no node holds the blob.`,
    });
  });
});

describe('POST /api/species/:id/image', () => {
  let store: PetShopStore;
  let server: FastifyInstance;

  beforeEach(async () => {
    store = await memoryStore();
    await store.seedIfEmpty();
    server = buildTestServer(store);
  });

  afterEach(async () => {
    await server.close();
    await store.close();
  });

  const upload = (
    id: string,
    payload: Buffer | string | undefined,
    contentType: string | undefined,
  ) =>
    server.inject({
      method: 'POST',
      url: `/api/species/${id}/image`,
      ...(contentType === undefined
        ? {}
        : { headers: { 'content-type': contentType } }),
      ...(payload === undefined ? {} : { payload }),
    });

  it('writes a new species version from a PNG body and serves the bytes at it', async () => {
    const png = Buffer.from(speciesImage('griffin'));

    const response = await upload('duck', png, 'image/png');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const species = response.json<SpeciesResponse>();
    expect(species).toStrictEqual({
      id: 'duck',
      hash: expect.any(String) as string,
      name: duck.name,
      latinName: duck.latinName,
      description: duck.description,
      imageUrl: `/api/species/${species.hash}/image`,
    });
    expect(species.hash).not.toBe(duck._hash);
    const listed = (
      await server.inject({ method: 'GET', url: '/api/species' })
    ).json<SpeciesResponse[]>();
    expect(listed.find((entry) => entry.id === 'duck')).toStrictEqual(species);
    const image = await server.inject({ method: 'GET', url: species.imageUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(image.rawPayload).toStrictEqual(png);
    expect(await store.hasLocalBlob(blobIdOf(png))).toBe(true);
  });

  it('accepts a JPEG and serves it as image/jpeg', async () => {
    const response = await upload('dog', jpegBytes, 'image/jpeg');

    expect(response.statusCode).toBe(200);
    const image = await server.inject({
      method: 'GET',
      url: response.json<SpeciesResponse>().imageUrl,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.rawPayload).toStrictEqual(jpegBytes);
  });

  it('answers the current version unchanged for the image it already has', async () => {
    const first = (
      await upload('duck', jpegBytes, 'image/jpeg')
    ).json<SpeciesResponse>();

    const second = await upload('duck', jpegBytes, 'image/jpeg');

    expect(second.statusCode).toBe(200);
    expect(second.json()).toStrictEqual(first);
  });

  it('answers 415 for a media type that is not PNG or JPEG', async () => {
    for (const [contentType, payload] of [
      ['text/plain', 'not an image'],
      ['image/webp', 'RIFF....WEBP'],
      ['application/json', JSON.stringify({ image: 'no' })],
    ] as const) {
      const response = await upload('duck', payload, contentType);
      expect(response.statusCode).toBe(415);
      expect(response.json()).toMatchObject({
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: expect.any(String) as string,
      });
    }
    const missing = await upload('duck', undefined, undefined);
    expect(missing.statusCode).toBe(415);
    expect(missing.json()).toMatchObject({
      message: 'An image is uploaded as image/png or image/jpeg, not as "".',
    });
  });

  it('answers 415 for bytes that are not the declared image', async () => {
    const html = await upload(
      'duck',
      Buffer.from('<!doctype html><p>duck</p>'),
      'image/png',
    );
    expect(html.statusCode).toBe(415);
    expect(html.json()).toStrictEqual({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message:
        'The body does not start like a PNG or JPEG image, whatever it was declared as.',
    });

    const mismatched = await upload('duck', jpegBytes, 'image/png');
    expect(mismatched.statusCode).toBe(415);
    expect(mismatched.json()).toStrictEqual({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'The body is image/jpeg, not the declared image/png.',
    });
    expect((await store.listSpecies()).map((row) => row._hash)).toContain(
      duck._hash,
    );
  });

  it('answers 400 for an empty body', async () => {
    const response = await upload('duck', Buffer.alloc(0), 'image/png');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toStrictEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'The body is empty; send the bytes of the image.',
    });
  });

  it('answers 413 for a body over one mebibyte', async () => {
    const oversized = Buffer.concat([
      Buffer.from(pngSignature),
      Buffer.alloc(maximumUploadedImageBytes),
    ]);

    const response = await upload('duck', oversized, 'image/png');

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
    });
    expect(await store.hasLocalBlob(blobIdOf(oversized))).toBe(false);
  });

  it('answers 404 for an unknown species and stores no blob', async () => {
    const response = await upload('unicorn', jpegBytes, 'image/jpeg');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No species with id "unicorn".',
    });
  });
});
