import { hashed } from '../hashing.ts';
import type { HashedSpeciesRow, SpeciesRow } from '../tables/species.ts';

const speciesRows: readonly SpeciesRow[] = [
  {
    id: 'duck',
    name: 'Duck',
    latinName: 'Anas platyrhynchos domesticus',
    description:
      'The signature species of Duckburg. Ducks here wear sailor suits ' +
      'without trousers, keep their fortunes in swimming-pool-sized money ' +
      'bins and lose their temper at roughly the speed of sound. Handle ' +
      'with patience and a spare set of nephews.',
  },
  {
    id: 'dog',
    name: 'Dog',
    latinName: 'Canis lupus familiaris',
    description:
      'Every police officer, most burglars and one very absent-minded ' +
      'neighbour in Duckburg belong to this species. Dogs are loyal, ' +
      'hard-working and easy to recognise by their black noses and ' +
      'matching prison numbers. Not every dog is a Beagle Boy, but every ' +
      'Beagle Boy is a dog.',
  },
  {
    id: 'chicken',
    name: 'Chicken',
    latinName: 'Gallus gallus domesticus',
    description:
      'The inventors of Duckburg, mostly. A chicken will build you a ' +
      'thinking cap, a robot butler or a small helpful light bulb before ' +
      'lunch and forget to ask what you actually wanted. Feed them ideas ' +
      'and keep anything flammable out of the workshop.',
  },
];

/**
 * The three species every node starts with. The rows are hashed here so
 * that every node computes the same `_hash` for the same content, which is
 * what lets nodes recognise each other's rows later.
 */
export const speciesSeed: readonly HashedSpeciesRow[] = speciesRows.map((row) =>
  hashed(row),
);
