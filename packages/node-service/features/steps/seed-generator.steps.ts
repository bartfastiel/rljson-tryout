import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import type { SeedSize } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { describe, expect, vi } from 'vitest';

import type { StorageKind } from '../../src/configuration.ts';
import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'seed-generator.feature'),
);

type StatsResponse = {
  seedSize: string;
  tables: Record<string, number>;
};

type AnimalPageResponse = {
  items: { hash: string; name: string; speciesName: string | null }[];
  total: number;
  limit: number;
  offset: number;
};

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

const dataDirectories = useTemporaryDataDirectories();

// Seeding `medium` into SQLite takes a few seconds on a CI runner, and
// every step of a scenario is one vitest test with the default timeout.
vi.setConfig({ testTimeout: 60_000 });

const seededWorld = async (
  storage: StorageKind,
  size: SeedSize,
): Promise<World> => {
  const world = await createWorld({
    storage,
    dataDirectory: dataDirectories.next(),
    seedSize: size,
  });
  await world.store.seedIfEmpty(size);
  return world;
};

const animalPage = async (
  world: World,
  query: string,
): Promise<AnimalPageResponse> => {
  const response = await world.server.inject({
    method: 'GET',
    url: `/api/animals${query}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AnimalPageResponse>();
};

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    const worlds: World[] = [];

    AfterEachScenario(async () => {
      for (const world of worlds.splice(0)) {
        await closeWorld(world);
      }
    });

    Scenario(
      'A node seeded with the medium size reports its tables',
      ({ Given, When, Then, And }) => {
        let response: Response;

        Given('a pet shop store seeded with the size "medium"', async () => {
          worlds.push(await seededWorld(storage, 'medium'));
        });

        When('the client requests the stats', async () => {
          response = await worlds[0]!.server.inject({
            method: 'GET',
            url: '/api/stats',
          });
        });

        Then('the stats report the seed size "medium" and 110 animals', () => {
          expect(response.statusCode).toBe(200);
          const stats = response.json<StatsResponse>();
          expect(stats.seedSize).toBe('medium');
          expect(stats.tables.animals).toBe(110);
        });

        And('every table has as many InsertHistory rows as rows', () => {
          const { tables } = response.json<StatsResponse>();
          for (const [table, count] of Object.entries(tables)) {
            if (!table.endsWith('InsertHistory')) {
              expect(count).toBeGreaterThan(0);
              expect(tables[`${table}InsertHistory`]).toBe(count);
            }
          }
        });
      },
    );

    Scenario(
      'The animal list is paged and searched on the node',
      ({ Given, When, Then, And }) => {
        let page: AnimalPageResponse;

        Given('a pet shop store seeded with the size "medium"', async () => {
          worlds.push(await seededWorld(storage, 'medium'));
        });

        When('the client requests the first page of animals', async () => {
          page = await animalPage(worlds[0]!, '');
        });

        Then('the page holds 50 of 110 animals', () => {
          expect(page.items).toHaveLength(50);
          expect(page).toMatchObject({ total: 110, limit: 50, offset: 0 });
        });

        When('the client requests the animals matching "quack"', async () => {
          page = await animalPage(worlds[0]!, '?q=quack');
        });

        Then(
          'every animal on the page has "quack" in its name or species',
          () => {
            expect(page.items.length).toBeGreaterThan(0);
            for (const animal of page.items) {
              expect(
                `${animal.name} ${animal.speciesName ?? ''}`.toLowerCase(),
              ).toContain('quack');
            }
          },
        );

        And('the page reports fewer animals than the store holds', () => {
          expect(page.total).toBe(page.items.length);
          expect(page.total).toBeLessThan(110);
        });
      },
    );

    Scenario(
      'Two nodes seeded with the same size hold the same animal versions',
      ({ Given, Then }) => {
        Given('two pet shop stores seeded with the size "medium"', async () => {
          worlds.push(
            await seededWorld(storage, 'medium'),
            await seededWorld(storage, 'medium'),
          );
        });

        Then('both stores serve the same animal hashes', async () => {
          const [first, second] = await Promise.all(
            worlds.map((world) => animalPage(world, '?limit=200')),
          );

          expect(first!.items.map((animal) => animal.hash)).toStrictEqual(
            second!.items.map((animal) => animal.hash),
          );
          expect(first!.total).toBe(110);
        });
      },
    );
  });
});
