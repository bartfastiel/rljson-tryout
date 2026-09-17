import { hashed } from '../hashing.ts';
import type { HashedPersonRow, PersonRow } from '../tables/persons.ts';

const personRows: readonly PersonRow[] = [
  {
    id: 'grandma-duck',
    name: 'Grandma Duck',
    street: 'Quackmore Farm Road 1',
    city: 'Duckburg',
    email: 'grandma.duck@duckburg.example',
  },
  {
    id: 'gyro-gearloose',
    name: 'Gyro Gearloose',
    street: 'Killmotor Hill 13',
    city: 'Duckburg',
    email: 'gyro.gearloose@duckburg.example',
  },
  {
    id: 'gladstone-gander',
    name: 'Gladstone Gander',
    street: 'Lucky Lane 7',
    city: 'Duckburg',
    email: 'gladstone.gander@duckburg.example',
  },
  {
    id: 'daisy-duck',
    name: 'Daisy Duck',
    street: 'Mockingbird Lane 4',
    city: 'Duckburg',
    email: 'daisy.duck@duckburg.example',
  },
  {
    id: 'fethry-duck',
    name: 'Fethry Duck',
    street: 'Tangleweed Trail 9',
    city: 'Duckburg',
    email: 'fethry.duck@duckburg.example',
  },
  {
    id: 'john-d-rockerduck',
    name: 'John D. Rockerduck',
    street: 'Rockerduck Tower Plaza 1',
    city: 'Duckburg',
    email: 'john.rockerduck@duckburg.example',
  },
];

/**
 * The six Duckburg persons every node starts with. `persons` is shared by
 * `breeders` (this slice, B7) and, later, `customers` (slice B8): some of
 * these six are referenced as a breeder's own person by `breedersSeed`,
 * some (Gladstone Gander, Fethry Duck) are seeded here without a role yet,
 * ready for slice B8 to reference them as customers. The rows are hashed
 * here so that every node computes the same `_hash` for the same content,
 * matching the pattern of `speciesSeed`.
 */
export const personsSeed: readonly HashedPersonRow[] = personRows.map((row) =>
  hashed(row),
);
