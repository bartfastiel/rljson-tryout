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
  {
    id: 'scrooge-mcduck',
    name: 'Scrooge McDuck',
    street: 'Killmotor Hill 1',
    city: 'Duckburg',
    email: 'scrooge.mcduck@duckburg.example',
  },
  {
    id: 'donald-duck',
    name: 'Donald Duck',
    street: 'Webfoot Walk 1313',
    city: 'Duckburg',
    email: 'donald.duck@duckburg.example',
  },
];

/**
 * The eight Duckburg persons every node starts with. `persons` is shared by
 * `breeders` (slice B7) and `customers` (slice B8): four of these are
 * referenced as a breeder's own person by `breedersSeed`, five as a
 * customer's person by `customersSeed`, and Grandma Duck is both, which is
 * what lets a breeder be a customer without a second person row. The two
 * persons added last (Scrooge McDuck, Donald Duck) come after the six from
 * slice B7 so that the earlier rows keep their hashes. The rows are hashed
 * here so that every node computes the same `_hash` for the same content,
 * matching the pattern of `speciesSeed`.
 */
export const personsSeed: readonly HashedPersonRow[] = personRows.map((row) =>
  hashed(row),
);
