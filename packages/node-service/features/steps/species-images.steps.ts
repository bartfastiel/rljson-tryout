import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { pngSignature, speciesSeed } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { describe, expect } from 'vitest';

import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'species-images.feature'),
);

type SpeciesListEntry = {
  id: string;
  hash: string;
  imageUrl: string;
};

type AnimalDetailResponse = {
  speciesId: string | null;
  speciesImageUrl: string | null;
};

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    let world: World | undefined;

    const freshlySeededStore = async (): Promise<void> => {
      world = await createWorld({
        storage,
        dataDirectory: dataDirectories.next(),
      });
      await world.store.seedIfEmpty();
    };

    AfterEachScenario(async () => {
      if (world !== undefined) {
        await closeWorld(world);
        world = undefined;
      }
    });

    Scenario(
      'The species list links every species to its image',
      ({ Given, When, Then, And }) => {
        let species: SpeciesListEntry[];

        Given('a freshly seeded pet shop store', freshlySeededStore);

        When('the client requests the species list', async () => {
          const response = await world!.server.inject({
            method: 'GET',
            url: '/api/species',
          });
          species = response.json<SpeciesListEntry[]>();
        });

        Then(
          'every listed species carries an image URL under /api/species',
          () => {
            expect(species).toHaveLength(speciesSeed.length);
            for (const entry of species) {
              expect(entry.imageUrl).toBe(`/api/species/${entry.hash}/image`);
            }
          },
        );

        And(
          'every linked image is a PNG served with an immutable cache header',
          async () => {
            for (const entry of species) {
              const response = await world!.server.inject({
                method: 'GET',
                url: entry.imageUrl,
              });
              expect(response.statusCode).toBe(200);
              expect(response.headers['content-type']).toBe('image/png');
              expect(response.headers['cache-control']).toBe(
                'public, max-age=31536000, immutable',
              );
              expect([...response.rawPayload.subarray(0, 8)]).toStrictEqual([
                ...pngSignature,
              ]);
            }
          },
        );
      },
    );

    Scenario(
      'An animal carries the image of its species version',
      ({ Given, When, Then }) => {
        let animal: AnimalDetailResponse;

        Given('a freshly seeded pet shop store', freshlySeededStore);

        When(
          'the client requests the seeded animal "sir-quackington"',
          async () => {
            const response = await world!.server.inject({
              method: 'GET',
              url: '/api/animals/sir-quackington',
            });
            animal = response.json<AnimalDetailResponse>();
          },
        );

        Then('the animal links to the image of the species "duck"', () => {
          const duck = speciesSeed.find((row) => row.id === 'duck')!;
          expect(animal.speciesId).toBe('duck');
          expect(animal.speciesImageUrl).toBe(
            `/api/species/${duck._hash}/image`,
          );
        });
      },
    );

    Scenario(
      'Seeding stores every species image exactly once',
      ({ Given, When, Then }) => {
        Given('a freshly seeded pet shop store', freshlySeededStore);

        When('the store is asked to seed again', async () => {
          const report = await world!.store.seedIfEmpty();
          expect(report.speciesSeeded).toBe(0);
        });

        Then('the blob store holds one blob per seeded species', async () => {
          const { blobs } = await world!.store.blobs.listBlobs();
          expect(blobs.map((blob) => blob.blobId).sort()).toStrictEqual(
            [...speciesSeed].map((row) => row.imageBlobId).sort(),
          );
        });
      },
    );

    Scenario(
      'An unknown species version has no image',
      ({ Given, When, Then }) => {
        let response: Response;

        Given('a freshly seeded pet shop store', freshlySeededStore);

        When(
          'the client requests the image of the species version "NoSuchSpeciesVersion00"',
          async () => {
            response = await world!.server.inject({
              method: 'GET',
              url: '/api/species/NoSuchSpeciesVersion00/image',
            });
          },
        );

        Then('the response is 404 Not Found', () => {
          expect(response.statusCode).toBe(404);
          expect(response.json()).toMatchObject({
            statusCode: 404,
            error: 'Not Found',
          });
        });
      },
    );
  });
});
