import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import type { FastifyInstance } from 'fastify';
import { describe, expect } from 'vitest';

import {
  storageKinds,
  useTemporaryDataDirectories,
} from '../../src/testing/testStores.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'versions.feature'),
);

type AnimalListEntry = {
  id: string;
  hash: string;
  priceCents: number;
};

type AnimalDetailResponse = {
  id: string;
  hash: string;
  name: string;
  priceCents: number;
  traits: { id: string; name: string }[];
};

type AnimalVersionResponse = {
  hash: string;
  timeId: string;
  previous: string[];
  current: boolean;
  priceCents: number;
  traitIds: string[];
};

type ErrorResponse = {
  statusCode: number;
  error: string;
  message: string;
};

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

const updateAnimal = (
  world: World,
  id: string,
  changes: Record<string, unknown>,
): Promise<Response> =>
  world.server.inject({
    method: 'PUT',
    url: `/api/animals/${id}`,
    payload: changes,
  });

const getAnimal = async (
  world: World,
  id: string,
  version?: string,
): Promise<AnimalDetailResponse> => {
  const response = await world.server.inject({
    method: 'GET',
    url:
      version === undefined
        ? `/api/animals/${id}`
        : `/api/animals/${id}?version=${version}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AnimalDetailResponse>();
};

const getHistory = async (
  world: World,
  id: string,
): Promise<AnimalVersionResponse[]> => {
  const response = await world.server.inject({
    method: 'GET',
    url: `/api/animals/${id}/history`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AnimalVersionResponse[]>();
};

const listAnimals = async (
  world: World,
  query = '',
): Promise<AnimalListEntry[]> => {
  const response = await world.server.inject({
    method: 'GET',
    url: `/api/animals${query}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AnimalListEntry[]>();
};

const dataDirectories = useTemporaryDataDirectories();

describe.each(storageKinds)('over the %s store', (storage) => {
  describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
    let world: World | undefined;

    AfterEachScenario(async () => {
      if (world !== undefined) {
        await closeWorld(world);
        world = undefined;
      }
    });

    Scenario('The price of an animal changes', ({ Given, When, Then, And }) => {
      let response: Response;
      let originalHash: string;
      let originalPriceCents: number;
      let history: AnimalVersionResponse[];

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld({
          storage,
          dataDirectory: dataDirectories.next(),
        });
        await world.store.seedIfEmpty();
        const original = await getAnimal(world, 'donald-the-third');
        originalHash = original.hash;
        originalPriceCents = original.priceCents;
      });

      When(
        'the shop keeper changes the price of "donald-the-third" to 61000 cents',
        async () => {
          response = await updateAnimal(world!, 'donald-the-third', {
            priceCents: 61000,
          });
        },
      );

      Then('the node answers 200 with the animal priced at 61000 cents', () => {
        expect(response.statusCode).toBe(200);
        const animal = response.json<AnimalDetailResponse>();
        expect(animal.id).toBe('donald-the-third');
        expect(animal.priceCents).toBe(61000);
        expect(animal.hash).not.toBe(originalHash);
      });

      And(
        'the animal list shows "donald-the-third" priced at 61000 cents, once',
        async () => {
          const entries = (await listAnimals(world!)).filter(
            (animal) => animal.id === 'donald-the-third',
          );

          expect(entries).toHaveLength(1);
          expect(entries[0]!.priceCents).toBe(61000);
          expect(entries[0]!.hash).toBe(
            response.json<AnimalDetailResponse>().hash,
          );
        },
      );

      And(
        'the animal detail shows "donald-the-third" priced at 61000 cents',
        async () => {
          expect((await getAnimal(world!, 'donald-the-third')).priceCents).toBe(
            61000,
          );
        },
      );

      And(
        'the history of "donald-the-third" lists two versions, newest first',
        async () => {
          history = await getHistory(world!, 'donald-the-third');

          expect(history).toHaveLength(2);
          expect(history[0]!.priceCents).toBe(61000);
          expect(history[1]!.priceCents).toBe(originalPriceCents);
          expect(history[1]!.hash).toBe(originalHash);
        },
      );

      And(
        'only the new version is current and it names the old one as previous',
        () => {
          expect(history[0]!.current).toBe(true);
          expect(history[1]!.current).toBe(false);
          expect(history[0]!.previous).toStrictEqual([history[1]!.timeId]);
          expect(history[1]!.previous).toStrictEqual([]);
        },
      );

      And(
        'the old version is still readable by its hash at its old price',
        async () => {
          const old = await getAnimal(world!, 'donald-the-third', originalHash);

          expect(old.hash).toBe(originalHash);
          expect(old.priceCents).toBe(originalPriceCents);
        },
      );
    });

    Scenario('An edit keeps the traits', ({ Given, When, Then, And }) => {
      let traitsBefore: { id: string; name: string }[];

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld({
          storage,
          dataDirectory: dataDirectories.next(),
        });
        await world.store.seedIfEmpty();
        traitsBefore = (await getAnimal(world, 'sir-quackington')).traits;
        expect(traitsBefore.length).toBeGreaterThan(1);
      });

      When(
        'the shop keeper renames "sir-quackington" to "Sir Quackington the First"',
        async () => {
          const response = await updateAnimal(world!, 'sir-quackington', {
            name: 'Sir Quackington the First',
          });
          expect(response.statusCode).toBe(200);
        },
      );

      Then(
        'the animal detail shows the name "Sir Quackington the First"',
        async () => {
          expect((await getAnimal(world!, 'sir-quackington')).name).toBe(
            'Sir Quackington the First',
          );
        },
      );

      And(
        'the animal detail still lists a trait named "Fiercely loyal"',
        async () => {
          const { traits } = await getAnimal(world!, 'sir-quackington');

          expect(traits).toStrictEqual(traitsBefore);
          expect(traits.map((trait) => trait.name)).toContain('Fiercely loyal');
        },
      );

      And(
        'the trait filter "fiercely-loyal" still returns "sir-quackington"',
        async () => {
          const animals = await listAnimals(world!, '?trait=fiercely-loyal');

          expect(animals.map((animal) => animal.id)).toContain(
            'sir-quackington',
          );
        },
      );

      And('both versions in the history carry the same traits', async () => {
        const history = await getHistory(world!, 'sir-quackington');

        expect(history).toHaveLength(2);
        expect([...history[0]!.traitIds].sort()).toStrictEqual(
          [...history[1]!.traitIds].sort(),
        );
        expect([...history[0]!.traitIds].sort()).toStrictEqual(
          traitsBefore.map((trait) => trait.id).sort(),
        );
      });
    });

    Scenario(
      'An invalid edit is refused and writes nothing',
      ({ Given, When, Then, And }) => {
        let response: Response;

        Given('a freshly seeded pet shop store', async () => {
          world = await createWorld({
            storage,
            dataDirectory: dataDirectories.next(),
          });
          await world.store.seedIfEmpty();
        });

        When(
          'the shop keeper changes the price of "donald-the-third" to -1 cents',
          async () => {
            response = await updateAnimal(world!, 'donald-the-third', {
              priceCents: -1,
            });
          },
        );

        Then(
          'the node answers 400 with the message "The price must be a whole number of cents, at least 0."',
          () => {
            expect(response.statusCode).toBe(400);
            expect(response.json<ErrorResponse>()).toStrictEqual({
              statusCode: 400,
              error: 'Bad Request',
              message: 'The price must be a whole number of cents, at least 0.',
            });
          },
        );

        And('the history of "donald-the-third" lists one version', async () => {
          expect(await getHistory(world!, 'donald-the-third')).toHaveLength(1);
        });
      },
    );
  });
});
