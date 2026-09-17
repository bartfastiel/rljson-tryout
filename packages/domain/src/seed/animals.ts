import { hashed } from '../hashing.ts';
import type { AnimalRow, HashedAnimalRow } from '../tables/animals.ts';
import { speciesSeed } from './species.ts';

/**
 * Looks up a seeded species by its `id` and returns its `_hash`, the value
 * an `animals` row needs in `speciesRef`. Throws when the id is unknown so a
 * typo in this file fails loudly instead of writing a dangling reference.
 */
const speciesRefFor = (speciesId: string): string => {
  const species = speciesSeed.find((row) => row.id === speciesId);
  if (species === undefined) {
    throw new Error(`No seeded species with id "${speciesId}".`);
  }
  return species._hash;
};

const animalRows: readonly AnimalRow[] = [
  {
    id: 'quackmore-junior',
    name: 'Quackmore Junior',
    speciesRef: speciesRefFor('duck'),
    bornOn: '2022-03-14',
    priceCents: 45000,
  },
  {
    id: 'donald-the-third',
    name: 'Donald the Third',
    speciesRef: speciesRefFor('duck'),
    bornOn: '2023-06-01',
    priceCents: 52000,
  },
  {
    id: 'daphne-duck',
    name: 'Daphne Duck',
    speciesRef: speciesRefFor('duck'),
    bornOn: '2021-11-09',
    priceCents: 38000,
  },
  {
    id: 'sir-quackington',
    name: 'Sir Quackington',
    speciesRef: speciesRefFor('duck'),
    bornOn: '2019-08-08',
    priceCents: 68000,
  },
  {
    id: 'bowser-the-guard-dog',
    name: 'Bowser the Guard Dog',
    speciesRef: speciesRefFor('dog'),
    bornOn: '2020-07-22',
    priceCents: 61000,
  },
  {
    id: 'nosey-the-bloodhound',
    name: 'Nosey the Bloodhound',
    speciesRef: speciesRefFor('dog'),
    bornOn: '2022-01-30',
    priceCents: 47000,
  },
  {
    id: 'pepper-the-poodle',
    name: 'Pepper the Poodle',
    speciesRef: speciesRefFor('dog'),
    bornOn: '2023-09-05',
    priceCents: 55000,
  },
  {
    id: 'clara-cluck-junior',
    name: 'Clara Cluck Junior',
    speciesRef: speciesRefFor('chicken'),
    bornOn: '2021-04-18',
    priceCents: 21000,
  },
  {
    id: 'gadget-the-inventor',
    name: 'Gadget the Inventor',
    speciesRef: speciesRefFor('chicken'),
    bornOn: '2022-12-02',
    priceCents: 27500,
  },
  {
    id: 'henrietta-the-egg-champion',
    name: 'Henrietta the Egg Champion',
    speciesRef: speciesRefFor('chicken'),
    bornOn: '2020-05-14',
    priceCents: 19500,
  },
];

/**
 * Ten Duckburg pets every node starts with, each referencing one of the
 * three seeded species by its `_hash`. The rows are hashed here so that
 * every node computes the same `_hash` for the same content, matching the
 * pattern of `speciesSeed`.
 */
export const animalsSeed: readonly HashedAnimalRow[] = animalRows.map((row) =>
  hashed(row),
);
