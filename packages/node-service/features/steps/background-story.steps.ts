import { resolve } from 'node:path';

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';
import { Route } from '@rljson/rljson';
import {
  animalsSeed,
  animalsTableCfg,
  hashed,
  type AnimalRow,
  type HashedAnimalRow,
} from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

import type { AnimalDetail } from '../../src/store/petShopStore.ts';
import { closeWorld, createWorld, type World } from '../world.ts';

const feature = await loadFeature(
  resolve(import.meta.dirname, '..', 'background-story.feature'),
);

/**
 * A deterministic story of exactly the given length: a fixed sentence
 * repeated and cut to size, so the scenario does not depend on any random
 * source and the exact character count is easy to reason about.
 */
const generatedStory = (length: number): string => {
  const sentence = 'The pet shop keeps growing its collection of stories. ';
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
};

/**
 * Writes a row directly into the store's `animals` table, bypassing the
 * `Db` instance's private field the same way `petShopStore.test.ts` does:
 * the store has no public write API before slice B9 (`PUT
 * /api/animals/:id`), so a Gherkin scenario that writes "through the store"
 * has to reach for the same private `db.insert` the store's own methods
 * use.
 */
type StoreInternals = {
  db: { insert: (route: Route, tree: unknown) => Promise<unknown> };
};

const insertAnimal = async (
  world: World,
  row: HashedAnimalRow,
): Promise<void> => {
  await (world.store as unknown as StoreInternals).db.insert(
    Route.fromFlat(animalsTableCfg.key),
    { [animalsTableCfg.key]: { _type: 'components', _data: [row] } },
  );
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
    'A long story round-trips through the store unchanged',
    ({ Given, When, Then, And }) => {
      let writtenRow: HashedAnimalRow | undefined;
      let readBackAnimal: AnimalDetail | undefined;

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld();
        await world.store.seedIfEmpty();
      });

      And('an animal with a generated 4000 character background story', () => {
        const row: AnimalRow = {
          id: 'generated-story-animal',
          name: 'Generated Story Animal',
          speciesRef: animalsSeed[0]!.speciesRef,
          bornOn: '2024-01-01',
          priceCents: 1000,
          backgroundStory: generatedStory(4000),
          traitsRefs: [],
        };
        writtenRow = hashed(row);
      });

      When('the animal is written through the store', async () => {
        await insertAnimal(world!, writtenRow!);
      });

      And('the same animal is read back from the store by its id', async () => {
        readBackAnimal = await world!.store.getAnimal(writtenRow!.id);
      });

      Then('the read-back story is exactly 4000 characters long', () => {
        expect(readBackAnimal?.backgroundStory.length).toBe(4000);
      });

      And('the read-back story equals the story that was written', () => {
        expect(readBackAnimal?.backgroundStory).toBe(
          writtenRow?.backgroundStory,
        );
      });

      And(
        'the read-back row hash equals the hash of the written animal row',
        () => {
          expect(readBackAnimal?.hash).toBe(writtenRow?._hash);
        },
      );
    },
  );

  Scenario(
    'The HTTP API serves the long background story of a seeded animal',
    ({ Given, When, Then, And }) => {
      let response: Awaited<ReturnType<FastifyInstance['inject']>>;

      Given('a freshly seeded pet shop store', async () => {
        world = await createWorld();
        await world.store.seedIfEmpty();
      });

      When(
        'the client requests the seeded animal with the longest background story',
        async () => {
          const longestStorySeedRow = animalsSeed.reduce((longest, animal) =>
            animal.backgroundStory.length > longest.backgroundStory.length
              ? animal
              : longest,
          );

          response = await world!.server.inject({
            method: 'GET',
            url: `/api/animals/${longestStorySeedRow.id}`,
          });
        },
      );

      Then('the response includes the species name', () => {
        const animal = response.json<AnimalDetail>();
        expect(animal.speciesName).toBeTruthy();
      });

      And(
        "the response's background story is at least 4000 characters long",
        () => {
          const animal = response.json<AnimalDetail>();
          expect(animal.backgroundStory.length).toBeGreaterThanOrEqual(4000);
        },
      );
    },
  );
});
