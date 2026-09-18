import { hashed } from '../hashing.ts';
import {
  speciesImageBlobId,
  speciesImageMimeType,
} from '../images/speciesImage.ts';
import type { HashedSpeciesRow, SpeciesRow } from '../tables/species.ts';

/**
 * The columns of a species row a seed author writes; the image columns
 * are derived from the id.
 */
type SpeciesSeedEntry = Omit<SpeciesRow, 'imageBlobId' | 'imageMimeType'>;

const speciesRows: readonly SpeciesSeedEntry[] = [
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
 * A complete species row for a seed entry: the image columns name the
 * procedural PNG of the species (`speciesImage`), whose blob id is a pure
 * function of the species id, so that the row hashes the same on every
 * node before any node has stored the image.
 */
export const speciesRowOf = (entry: SpeciesSeedEntry): HashedSpeciesRow =>
  hashed({
    ...entry,
    imageBlobId: speciesImageBlobId(entry.id),
    imageMimeType: speciesImageMimeType,
  });

/**
 * The three species every node starts with. The rows are hashed here so
 * that every node computes the same `_hash` for the same content, which is
 * what lets nodes recognise each other's rows later.
 */
export const speciesSeed: readonly HashedSpeciesRow[] =
  speciesRows.map(speciesRowOf);
