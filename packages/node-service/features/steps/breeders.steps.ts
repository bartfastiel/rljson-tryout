import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'breeders.feature'),
);

type BreederListEntry = {
  id: string;
  farmName: string;
  person: { id: string; name: string; city: string } | null;
};

type AnimalDetailResponse = {
  id: string;
  breeder: { id: string; farmName: string } | null;
};

type AnimalListEntry = {
  id: string;
  breederId: string | null;
  breederFarmName: string | null;
};

describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
  let world: World | undefined;

  AfterEachScenario(async () => {
    if (world !== undefined) {
      await closeWorld(world);
      world = undefined;
    }
  });

  Scenario(
    'The breeder list shows every breeder with their person data',
    ({ Given, When, Then }) => {
      let response: Awaited<ReturnType<FastifyInstance['inject']>>;

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld();
        await world.store.seedIfEmpty();
      });

      When('the client requests the breeders', async () => {
        response = await world!.server.inject({
          method: 'GET',
          url: '/api/breeders',
        });
      });

      Then(
        "every returned breeder includes its supplying person's name and city",
        () => {
          const breeders = response.json<BreederListEntry[]>();
          expect(breeders.length).toBeGreaterThan(0);

          for (const breeder of breeders) {
            expect(breeder.person).not.toBeNull();
            expect(breeder.person!.name).not.toBe('');
            expect(breeder.person!.city).not.toBe('');
          }
        },
      );
    },
  );

  Scenario('An animal detail names its breeder', ({ Given, When, Then }) => {
    let response: Awaited<ReturnType<FastifyInstance['inject']>>;

    Given('a freshly seeded pet shop store', async () => {
      world = await createWorld();
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

    Then('the response names the breeder "Daisy\'s Duckling Nursery"', () => {
      const animal = response.json<AnimalDetailResponse>();
      expect(animal.breeder?.farmName).toBe("Daisy's Duckling Nursery");
    });
  });

  Scenario(
    'Filtering animals by breeder returns only animals from that breeder',
    ({ Given, When, Then, And }) => {
      let response: Awaited<ReturnType<FastifyInstance['inject']>>;

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld();
        await world.store.seedIfEmpty();
      });

      When(
        'the client requests the animals of the breeder "grandma-ducks-farm"',
        async () => {
          response = await world!.server.inject({
            method: 'GET',
            url: '/api/animals?breeder=grandma-ducks-farm',
          });
        },
      );

      Then('every returned animal was bred by "Grandma Duck\'s Farm"', () => {
        const animals = response.json<AnimalListEntry[]>();
        expect(animals.length).toBeGreaterThan(0);

        for (const animal of animals) {
          expect(animal.breederId).toBe('grandma-ducks-farm');
          expect(animal.breederFarmName).toBe("Grandma Duck's Farm");
        }
      });

      And('not every seeded animal is returned', () => {
        const animals = response.json<AnimalListEntry[]>();
        expect(animals.length).toBeLessThan(10);
      });
    },
  );
});
