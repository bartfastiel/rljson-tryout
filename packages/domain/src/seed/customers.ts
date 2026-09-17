import { hashed } from '../hashing.ts';
import type { CustomerRow, HashedCustomerRow } from '../tables/customers.ts';
import { personsSeed } from './persons.ts';

/**
 * Looks up a seeded person by their `id` and returns their `_hash`, the
 * value a `customers` row needs in `personRef`. Throws when the id is
 * unknown so a typo in this file fails loudly instead of writing a dangling
 * reference, the same guard `breedersSeed` uses.
 */
const personRefFor = (personId: string): string => {
  const person = personsSeed.find((row) => row.id === personId);
  if (person === undefined) {
    throw new Error(`No seeded person with id "${personId}".`);
  }
  return person._hash;
};

const customerRows: readonly CustomerRow[] = [
  {
    id: 'scrooge-mcduck',
    personRef: personRefFor('scrooge-mcduck'),
    customerNumber: 'C-0001',
  },
  {
    id: 'donald-duck',
    personRef: personRefFor('donald-duck'),
    customerNumber: 'C-0002',
  },
  {
    id: 'gladstone-gander',
    personRef: personRefFor('gladstone-gander'),
    customerNumber: 'C-0003',
  },
  {
    id: 'fethry-duck',
    personRef: personRefFor('fethry-duck'),
    customerNumber: 'C-0004',
  },
  {
    id: 'grandma-duck',
    personRef: personRefFor('grandma-duck'),
    customerNumber: 'C-0005',
  },
];

/**
 * The five Duckburg customers every node starts with, Scrooge McDuck first.
 * Each references a seeded person by `_hash`; Grandma Duck is also the
 * person behind the breeder "Grandma Duck's Farm" in `breedersSeed`, which
 * is how the seed shows that a breeder can be a customer. A customer's
 * `id` equals its person's `id` for readability, not by rule: the two
 * tables are only linked through `personRef`. The rows are hashed here so
 * that every node computes the same `_hash` for the same content, matching
 * the pattern of `speciesSeed`.
 */
export const customersSeed: readonly HashedCustomerRow[] = customerRows.map(
  (row) => hashed(row),
);
