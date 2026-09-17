import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import type { FastifyInstance } from 'fastify';
import { describe, expect } from 'vitest';

import type { TraitRelationMode } from '../../src/store/traitRelation.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'traits.feature'),
);

type AnimalListEntry = {
  id: string;
  speciesId: string | null;
};

type AnimalDetailResponse = {
  id: string;
  traits: { id: string; name: string }[];
};

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(
    feature,
    ({ Scenario, ScenarioOutline, AfterEachScenario }) => {
      let world: World | undefined;

      AfterEachScenario(async () => {
        if (world !== undefined) {
          await closeWorld(world);
          world = undefined;
        }
      });

      Scenario(
        'Filtering by a trait returns only animals carrying it',
        ({ Given, When, Then, And }) => {
          let response: Awaited<ReturnType<FastifyInstance['inject']>>;

          Given('a freshly seeded pet shop store', async () => {
            world = await createWorld({
              storage,
              dataDirectory: dataDirectories.next(),
            });
            await world.store.seedIfEmpty();
          });

          When(
            'the client requests the animals with the trait "competitive-streak"',
            async () => {
              response = await world!.server.inject({
                method: 'GET',
                url: '/api/animals?trait=competitive-streak',
              });
            },
          );

          Then(
            'every returned animal carries the trait "competitive-streak"',
            async () => {
              const animals = response.json<{ items: AnimalListEntry[] }>()
                .items;
              expect(animals.length).toBeGreaterThan(0);

              for (const animal of animals) {
                const detailResponse = await world!.server.inject({
                  method: 'GET',
                  url: `/api/animals/${animal.id}`,
                });
                const detail = detailResponse.json<AnimalDetailResponse>();
                expect(
                  detail.traits.some(
                    (trait) => trait.id === 'competitive-streak',
                  ),
                ).toBe(true);
              }
            },
          );

          And('not every seeded animal is returned', () => {
            const animals = response.json<{ items: AnimalListEntry[] }>().items;
            expect(animals.length).toBeLessThan(10);
          });
        },
      );

      Scenario(
        'An animal detail lists its traits by name',
        ({ Given, When, Then }) => {
          let response: Awaited<ReturnType<FastifyInstance['inject']>>;

          Given('a freshly seeded pet shop store', async () => {
            world = await createWorld({
              storage,
              dataDirectory: dataDirectories.next(),
            });
            await world.store.seedIfEmpty();
          });

          When(
            'the client requests the seeded animal "sir-quackington"',
            async () => {
              response = await world!.server.inject({
                method: 'GET',
                url: '/api/animals/sir-quackington',
              });
            },
          );

          Then('the response lists a trait named "Fiercely loyal"', () => {
            const animal = response.json<AnimalDetailResponse>();
            expect(animal.traits.map((trait) => trait.name)).toContain(
              'Fiercely loyal',
            );
          });
        },
      );

      Scenario(
        'A species filter and a trait filter combine',
        ({ Given, When, Then }) => {
          let response: Awaited<ReturnType<FastifyInstance['inject']>>;

          Given('a freshly seeded pet shop store', async () => {
            world = await createWorld({
              storage,
              dataDirectory: dataDirectories.next(),
            });
            await world.store.seedIfEmpty();
          });

          When(
            'the client requests the animals of species "chicken" with the trait "competitive-streak"',
            async () => {
              response = await world!.server.inject({
                method: 'GET',
                url: '/api/animals?species=chicken&trait=competitive-streak',
              });
            },
          );

          Then(
            'exactly the animal "henrietta-the-egg-champion" is returned',
            () => {
              const animals = response.json<{ items: AnimalListEntry[] }>()
                .items;
              expect(animals.map((animal) => animal.id)).toStrictEqual([
                'henrietta-the-egg-champion',
              ]);
            },
          );
        },
      );

      Scenario(
        'An unknown trait id filters out every animal',
        ({ Given, When, Then }) => {
          let response: Awaited<ReturnType<FastifyInstance['inject']>>;

          Given('a freshly seeded pet shop store', async () => {
            world = await createWorld({
              storage,
              dataDirectory: dataDirectories.next(),
            });
            await world.store.seedIfEmpty();
          });

          When(
            'the client requests the animals with the trait "telekinesis"',
            async () => {
              response = await world!.server.inject({
                method: 'GET',
                url: '/api/animals?trait=telekinesis',
              });
            },
          );

          Then('the response is an empty page', () => {
            expect(response.json()).toStrictEqual({
              items: [],
              total: 0,
              limit: 50,
              offset: 0,
            });
          });
        },
      );

      ScenarioOutline(
        'The trait filter answers identically in both trait relation modes',
        ({ Given, When, Then, And }, variables) => {
          let response: Awaited<ReturnType<FastifyInstance['inject']>>;

          Given(
            'a freshly seeded pet shop store reading traits through "<mode>"',
            async () => {
              world = await createWorld({
                storage,
                dataDirectory: dataDirectories.next(),
                traitRelationMode: variables.mode as TraitRelationMode,
              });
              await world.store.seedIfEmpty();
            },
          );

          When(
            'the client requests the animals with the trait "competitive-streak"',
            async () => {
              response = await world!.server.inject({
                method: 'GET',
                url: '/api/animals?trait=competitive-streak',
              });
            },
          );

          Then(
            'every returned animal carries the trait "competitive-streak"',
            async () => {
              const animals = response.json<{ items: AnimalListEntry[] }>()
                .items;
              expect(animals.length).toBeGreaterThan(0);

              for (const animal of animals) {
                const detailResponse = await world!.server.inject({
                  method: 'GET',
                  url: `/api/animals/${animal.id}`,
                });
                const detail = detailResponse.json<AnimalDetailResponse>();
                expect(
                  detail.traits.some(
                    (trait) => trait.id === 'competitive-streak',
                  ),
                ).toBe(true);
              }
            },
          );

          And('not every seeded animal is returned', () => {
            const animals = response.json<{ items: AnimalListEntry[] }>().items;
            expect(animals.length).toBeLessThan(10);
          });
        },
      );
    },
  );
});
