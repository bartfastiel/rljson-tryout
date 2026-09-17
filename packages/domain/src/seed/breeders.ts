import { hashed } from '../hashing.ts';
import type { BreederRow, HashedBreederRow } from '../tables/breeders.ts';
import { personsSeed } from './persons.ts';

/**
 * Looks up a seeded person by their `id` and returns their `_hash`, the
 * value a `breeders` row needs in `personRef`. Throws when the id is
 * unknown so a typo in this file fails loudly instead of writing a dangling
 * reference.
 */
const personRefFor = (personId: string): string => {
  const person = personsSeed.find((row) => row.id === personId);
  if (person === undefined) {
    throw new Error(`No seeded person with id "${personId}".`);
  }
  return person._hash;
};

const breederRows: readonly BreederRow[] = [
  {
    id: 'grandma-ducks-farm',
    personRef: personRefFor('grandma-duck'),
    farmName: "Grandma Duck's Farm",
    suppliesSince: '1990-06-01',
  },
  {
    id: 'gearloose-workshop-hatchery',
    personRef: personRefFor('gyro-gearloose'),
    farmName: 'Gearloose Workshop Hatchery',
    suppliesSince: '2015-01-01',
  },
  {
    id: 'daisys-duckling-nursery',
    personRef: personRefFor('daisy-duck'),
    farmName: "Daisy's Duckling Nursery",
    suppliesSince: '2010-03-01',
  },
  {
    id: 'rockerduck-kennels',
    personRef: personRefFor('john-d-rockerduck'),
    farmName: 'Rockerduck Kennels',
    suppliesSince: '2012-11-01',
  },
];

/**
 * The four Duckburg breeders every node starts with, Grandma Duck's farm
 * first. Every seeded animal in `animalsSeed` references one of these by
 * `_hash`, chosen to fit the animal's own `backgroundStory`: Grandma Duck's
 * Farm for the animals her story already claims (Pepper the Poodle,
 * Henrietta the Egg Champion), Gearloose Workshop Hatchery for the two
 * chickens raised underfoot in Gyro's workshop (Clara Cluck Junior, Gadget
 * the Inventor), Daisy's Duckling Nursery for the four ducks and Rockerduck
 * Kennels for the two dogs. The rows are hashed here so that every node
 * computes the same `_hash` for the same content, matching the pattern of
 * `speciesSeed`.
 */
export const breedersSeed: readonly HashedBreederRow[] = breederRows.map(
  (row) => hashed(row),
);
