import { hashed } from '../hashing.ts';
import {
  animalTraitId,
  type AnimalTraitRow,
  type HashedAnimalTraitRow,
} from '../tables/animalTraits.ts';
import { animalsSeed } from './animals.ts';
import { traitsSeed } from './traits.ts';

/**
 * Looks up a seeded trait by its `_hash` and returns its `id`, needed to
 * build the deterministic `animalTraits` row id below. Throws when the hash
 * is unknown so a change to `animalsSeed` or `traitsSeed` that breaks the
 * cross-reference fails loudly instead of writing a dangling `traitRef`.
 */
const traitIdForHash = (traitHash: string): string => {
  const trait = traitsSeed.find((row) => row._hash === traitHash);
  if (trait === undefined) {
    throw new Error(`No seeded trait with hash "${traitHash}".`);
  }
  return trait.id;
};

/**
 * One `animalTraits` row per entry of every seeded animal's `traitsRefs`,
 * derived from `animalsSeed` rather than hand-written: the junction table is
 * an alternative representation of the exact same n-to-m relation slice B5
 * already seeded as a multi-reference, so deriving it here keeps the two
 * seeds from drifting apart and, incidentally, keeps this slice's own
 * changes to the seed data limited to nothing at all (`animalsSeed` and
 * `traitsSeed` are untouched). `id` is the deterministic slug
 * `<animalId>--<traitId>`, stable across nodes because both halves are
 * themselves stable ids; `animalRef` and `traitRef` are the `_hash`es the
 * multi-reference column already carries, so no additional lookup beyond
 * resolving a trait hash back to its id (for the readable half of the slug)
 * is needed. The rows are hashed here so that every node computes the same
 * `_hash` for the same content, matching the pattern of `animalsSeed`.
 */
export const animalTraitsSeed: readonly HashedAnimalTraitRow[] =
  animalsSeed.flatMap((animal) =>
    animal.traitsRefs.map((traitRef) => {
      const row: AnimalTraitRow = {
        id: animalTraitId(animal.id, traitIdForHash(traitRef)),
        animalRef: animal._hash,
        traitRef,
      };
      return hashed(row);
    }),
  );
