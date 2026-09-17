import type {
  HashedAnimalRow,
  HashedAnimalTraitRow,
  HashedTraitRow,
} from '@rljson-tryout/domain';

/**
 * The mode `PetShopStore` reads the animal-trait n-to-m relation through,
 * driven by the configuration variable `TRAIT_RELATION` (roadmap section
 * 2.4). Both modes read from the same seeded data and must answer every
 * query identically (`docs/findings/n-to-m.md`); only the tables involved
 * and the number of `Db.get` calls differ.
 */
export type TraitRelationMode = 'multi-reference' | 'junction';

/**
 * Resolves which traits an animal carries and which animals carry a trait,
 * regardless of whether the relation is stored as the `jsonArray`
 * multi-reference `animals.traitsRefs` (slice B5) or as rows in the
 * `animalTraits` junction table (slice B6). `PetShopStore` builds one
 * implementation per call from the tables it already read, and uses it for
 * both the `?trait=<id>` filter of `GET /api/animals` and the `traits` list
 * of `GET /api/animals/:id`, so the rest of the store does not need to know
 * which representation is active.
 */
export interface TraitRelation {
  /**
   * Every trait id the animal with this `_hash` carries, in no particular
   * order. A hash that does not resolve to a stored trait is left out
   * rather than failing, the same tolerance `PetShopStore` already has for
   * a dangling `speciesRef`.
   */
  traitIdsOfAnimal(animalHash: string): string[];

  /**
   * The `_hash` of every animal that carries the trait with this `_hash`,
   * in no particular order.
   */
  animalHashesWithTrait(traitHash: string): string[];
}

/**
 * Resolves trait hashes to the ids `TraitRelation` reports, shared by both
 * implementations below: neither `animals.traitsRefs` nor an `animalTraits`
 * row carries a trait's `id` directly, only its `_hash`.
 */
const traitIdByHash = (
  traits: readonly HashedTraitRow[],
): Map<string, string> =>
  new Map(traits.map((trait) => [trait._hash, trait.id]));

/**
 * Reads the relation from `animals.traitsRefs`, the `jsonArray`
 * multi-reference slice B5 introduced: one `Db.get` on `animals` already
 * carries every animal's traits, so no further table is needed here.
 */
export class MultiReferenceTraitRelation implements TraitRelation {
  private readonly animalsByHash: Map<string, HashedAnimalRow>;
  private readonly traitIdByHash: Map<string, string>;

  constructor(
    animals: readonly HashedAnimalRow[],
    traits: readonly HashedTraitRow[],
  ) {
    this.animalsByHash = new Map(
      animals.map((animal) => [animal._hash, animal]),
    );
    this.traitIdByHash = traitIdByHash(traits);
  }

  traitIdsOfAnimal(animalHash: string): string[] {
    const animal = this.animalsByHash.get(animalHash);
    if (animal === undefined) {
      return [];
    }

    return animal.traitsRefs
      .map((traitRef) => this.traitIdByHash.get(traitRef))
      .filter((id): id is string => id !== undefined);
  }

  animalHashesWithTrait(traitHash: string): string[] {
    return [...this.animalsByHash.values()]
      .filter((animal) => animal.traitsRefs.includes(traitHash))
      .map((animal) => animal._hash);
  }
}

/**
 * Reads the relation from the `animalTraits` junction table (slice B6): one
 * row per animal-trait pairing, each carrying the `_hash` of both sides.
 */
export class JunctionTraitRelation implements TraitRelation {
  private readonly rows: readonly HashedAnimalTraitRow[];
  private readonly traitIdByHash: Map<string, string>;

  constructor(
    animalTraits: readonly HashedAnimalTraitRow[],
    traits: readonly HashedTraitRow[],
  ) {
    this.rows = animalTraits;
    this.traitIdByHash = traitIdByHash(traits);
  }

  traitIdsOfAnimal(animalHash: string): string[] {
    return this.rows
      .filter((row) => row.animalRef === animalHash)
      .map((row) => this.traitIdByHash.get(row.traitRef))
      .filter((id): id is string => id !== undefined);
  }

  animalHashesWithTrait(traitHash: string): string[] {
    return this.rows
      .filter((row) => row.traitRef === traitHash)
      .map((row) => row.animalRef);
  }
}
