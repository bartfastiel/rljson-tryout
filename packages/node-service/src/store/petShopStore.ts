import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route, type ComponentsTable } from '@rljson/rljson';
import {
  animalsInsertHistoryTableCfg,
  animalsSeed,
  animalsTableCfg,
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  traitsInsertHistoryTableCfg,
  traitsSeed,
  traitsTableCfg,
  type HashedAnimalRow,
  type HashedSpeciesRow,
  type HashedTraitRow,
} from '@rljson-tryout/domain';

const speciesRoute = Route.fromFlat(speciesTableCfg.key);
const animalsRoute = Route.fromFlat(animalsTableCfg.key);
const traitsRoute = Route.fromFlat(traitsTableCfg.key);

/**
 * One trait as an animal carries it, resolved from a `traitsRefs` hash to
 * the trait's stable `id` and current `name`. Used both by
 * `PetShopStore.listTraits` (every trait in the store) and as the shape of
 * `AnimalDetail.traits` (the traits one animal carries).
 */
export type TraitSummary = {
  id: string;
  name: string;
};

/**
 * One trait version as `PetShopStore.listTraits` returns it: the full
 * `traits` row plus its `_hash`, the identity of this exact version.
 */
export type Trait = {
  id: string;
  hash: string;
  name: string;
  description: string;
};

/**
 * One animal as `PetShopStore.listAnimals` returns it: the fields a caller
 * needs to show a card, with the referenced species already resolved to its
 * `id` and `name` so the caller never has to look `speciesRef` up itself.
 * `speciesId` and `speciesName` are `null` for the store-integrity case of
 * an animal whose `speciesRef` does not resolve to a species in the store,
 * rather than the method failing the whole list for one broken row. Traits
 * are used to filter this list (`AnimalFilter.traitId`) but never appear in
 * it themselves, so the list stays as light as `backgroundStory` already
 * keeps it; only `AnimalDetail` carries them.
 */
export type AnimalWithSpecies = {
  id: string;
  hash: string;
  name: string;
  speciesId: string | null;
  speciesName: string | null;
  bornOn: string;
  priceCents: number;
};

/**
 * Narrows a filter for `listAnimals` to the animals of one species and, or,
 * one trait. Both narrow the same list and combine with a logical AND.
 */
export type AnimalFilter = {
  speciesId?: string;
  traitId?: string;
};

/**
 * One animal as `PetShopStore.getAnimal` returns it: everything
 * `AnimalWithSpecies` has, plus the full `backgroundStory` and the traits
 * this animal carries, resolved to their `id` and `name`. `GET
 * /api/animals` never includes these fields so that the list stays light;
 * only the detail endpoint does (roadmap section 2.5). A `traitsRefs` entry
 * that does not resolve to a stored trait is left out of `traits` rather
 * than failing the whole request, the same tolerance `speciesId` and
 * `speciesName` already have for a dangling `speciesRef`.
 */
export type AnimalDetail = AnimalWithSpecies & {
  backgroundStory: string;
  traits: TraitSummary[];
};

/**
 * Resolves the `traitsRefs` hashes of one animal row to the traits they
 * currently point at, dropping any hash that does not resolve to a stored
 * trait instead of failing: `traitsRefs` is a `jsonArray`, so a broken entry
 * can simply be left out of the result, unlike a single-valued reference
 * column such as `speciesRef`, which has to report `null` because it has no
 * "leave it out" option.
 */
const resolveTraits = (
  traitsRefs: readonly string[],
  traitsByHash: Map<string, HashedTraitRow>,
): TraitSummary[] =>
  traitsRefs
    .map((traitRef) => traitsByHash.get(traitRef))
    .filter((trait): trait is HashedTraitRow => trait !== undefined)
    .map((trait) => ({ id: trait.id, name: trait.name }));

/**
 * The node's data: an rljson `Db` over an in-memory `IoMem`. Later slices
 * put SQLite and SQL Server behind the same `Db`.
 */
export class PetShopStore {
  private readonly io = new IoMem();
  private readonly db = new Db(this.io);

  /**
   * Opens the store and creates every domain table together with its
   * InsertHistory companion. Must run before any other method.
   */
  async initialize(): Promise<void> {
    await this.io.init();
    await this.io.isReady();
    for (const tableCfg of [
      speciesTableCfg,
      speciesInsertHistoryTableCfg,
      traitsTableCfg,
      traitsInsertHistoryTableCfg,
      animalsTableCfg,
      animalsInsertHistoryTableCfg,
    ]) {
      await this.db.core.createTable(tableCfg);
    }
  }

  /**
   * Inserts the seed species, the seed traits and, once both are in place,
   * the seed animals, skipping a step when its table already holds rows.
   * Animals reference species and traits by hash, so both are always seeded
   * first. Every row is inserted on its own because `Db.insert` records
   * only the first row of a multi-row insert in the InsertHistory.
   */
  async seedIfEmpty(): Promise<{
    speciesSeeded: number;
    traitsSeeded: number;
    animalsSeeded: number;
  }> {
    const speciesSeeded = await this.seedTableIfEmpty(
      speciesTableCfg.key,
      speciesRoute,
      speciesSeed,
    );
    const traitsSeeded = await this.seedTableIfEmpty(
      traitsTableCfg.key,
      traitsRoute,
      traitsSeed,
    );
    const animalsSeeded = await this.seedTableIfEmpty(
      animalsTableCfg.key,
      animalsRoute,
      animalsSeed,
    );

    return { speciesSeeded, traitsSeeded, animalsSeeded };
  }

  private async seedTableIfEmpty(
    tableKey: string,
    route: Route,
    rows: readonly (HashedSpeciesRow | HashedTraitRow | HashedAnimalRow)[],
  ): Promise<number> {
    if ((await this.io.rowCount(tableKey)) > 0) {
      return 0;
    }

    for (const row of rows) {
      await this.db.insert(route, {
        [tableKey]: { _type: 'components', _data: [row] },
      });
    }

    return rows.length;
  }

  /**
   * Every species version in the store, ordered by `id`. The store hands
   * rows back sorted by hash, which is stable but meaningless to a reader.
   */
  async listSpecies(): Promise<HashedSpeciesRow[]> {
    const { rljson } = await this.db.get(speciesRoute, {});
    const table = rljson[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;

    return [...table._data].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  /**
   * Every trait version in the store, ordered by `id`, in the shape `GET
   * /api/traits` serves (roadmap section 2.5).
   */
  async listTraits(): Promise<Trait[]> {
    const { rljson } = await this.db.get(traitsRoute, {});
    const table = rljson[traitsTableCfg.key] as ComponentsTable<HashedTraitRow>;

    return [...table._data]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((row) => ({
        id: row.id,
        hash: row._hash,
        name: row.name,
        description: row.description,
      }));
  }

  /**
   * Every animal version in the store with its species joined, optionally
   * narrowed to one species, one trait, or both, ordered by `id`. Fetches
   * `animals`, `species` and `traits` separately and joins them with local
   * `Map`s, the explicit fallback of roadmap section 3.2: the rljson route
   * join `animals/species` was tried first, but it silently drops an animal
   * row whose `speciesRef` does not resolve instead of including it with a
   * missing species, which defeats listing every animal
   * (`docs/findings/db-basics.md`, "Joining a reference"). Filtering happens
   * here, in plain JavaScript, after this full read, for the same reason
   * `getAnimal` cannot filter `db.get` by `where`: `id` collides with a
   * column of the *referenced* `species` table and is silently mismatched
   * by `ComponentController`'s reference resolution
   * (`docs/findings/db-basics.md`, "Filtering by id"), and `traitId` would
   * have to be resolved against `traitsRefs` element by element besides, a
   * shape `where` cannot express at all. An unknown `speciesId` or `traitId`
   * filter yields an empty list rather than an error. An animal whose
   * `speciesRef` does not resolve (nothing writes one today; `Db.insert`
   * and `IoMem` do not check references, only `Validate` does, see the
   * finding above) gets `speciesId` and `speciesName` of `null` instead of
   * failing the whole list; an animal whose `traitsRefs` holds a dangling
   * hash simply does not match a `traitId` filter for that hash.
   */
  async listAnimals(filter: AnimalFilter = {}): Promise<AnimalWithSpecies[]> {
    const [
      { rljson: animalsContainer },
      { rljson: speciesContainer },
      { rljson: traitsContainer },
    ] = await Promise.all([
      this.db.get(animalsRoute, {}),
      this.db.get(speciesRoute, {}),
      this.db.get(traitsRoute, {}),
    ]);
    const animalsTable = animalsContainer[
      animalsTableCfg.key
    ] as ComponentsTable<HashedAnimalRow>;
    const speciesTable = speciesContainer[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;
    const traitsTable = traitsContainer[
      traitsTableCfg.key
    ] as ComponentsTable<HashedTraitRow>;
    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const traitsByHash = new Map(
      traitsTable._data.map((trait) => [trait._hash, trait]),
    );

    const matchesFilter = (animal: HashedAnimalRow): boolean => {
      if (filter.speciesId !== undefined) {
        const species = speciesByHash.get(animal.speciesRef);
        if (species?.id !== filter.speciesId) {
          return false;
        }
      }
      if (filter.traitId !== undefined) {
        const traitIds = resolveTraits(animal.traitsRefs, traitsByHash).map(
          (trait) => trait.id,
        );
        if (!traitIds.includes(filter.traitId)) {
          return false;
        }
      }
      return true;
    };

    const entries = animalsTable._data.filter(matchesFilter).map((animal) => {
      const species = speciesByHash.get(animal.speciesRef);

      return {
        id: animal.id,
        hash: animal._hash,
        name: animal.name,
        speciesId: species?.id ?? null,
        speciesName: species?.name ?? null,
        bornOn: animal.bornOn,
        priceCents: animal.priceCents,
      };
    });

    return entries.sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * The current version of one animal with its species joined, its traits
   * resolved and its full `backgroundStory`, or `undefined` when no animal
   * has this id.
   *
   * Filtering `db.get(animalsRoute, { id })` directly looks like the obvious
   * approach (`docs/findings/db-basics.md`, "Get") and works for columns
   * such as `bornOn`, but not for `id`: `ComponentController._referenceColumns`
   * resolves to the *referenced* table's columns instead of the referencing
   * table's own ref columns, so a `where` key that happens to also be a
   * column of the `species` table (`id`, `name`, `_hash`) is wrongly treated
   * as a foreign-key lookup into `species` and matches nothing (see
   * "Filtering by id" in `docs/findings/db-basics.md`). This method
   * therefore reuses `listAnimals`'s explicit fallback instead: read every
   * table in full and join them with local `Map`s, then find the animal by
   * `id` in JavaScript. An animal whose `speciesRef` does not resolve gets
   * `speciesId` and `speciesName` of `null`, the same tolerance
   * `listAnimals` has; a `traitsRefs` entry that does not resolve is simply
   * left out of `traits` (see `resolveTraits`).
   */
  async getAnimal(id: string): Promise<AnimalDetail | undefined> {
    const [
      { rljson: animalsContainer },
      { rljson: speciesContainer },
      { rljson: traitsContainer },
    ] = await Promise.all([
      this.db.get(animalsRoute, {}),
      this.db.get(speciesRoute, {}),
      this.db.get(traitsRoute, {}),
    ]);
    const animalsTable = animalsContainer[
      animalsTableCfg.key
    ] as ComponentsTable<HashedAnimalRow>;
    const speciesTable = speciesContainer[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;
    const traitsTable = traitsContainer[
      traitsTableCfg.key
    ] as ComponentsTable<HashedTraitRow>;

    const animal = animalsTable._data.find((row) => row.id === id);
    if (animal === undefined) {
      return undefined;
    }

    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const traitsByHash = new Map(
      traitsTable._data.map((trait) => [trait._hash, trait]),
    );
    const species = speciesByHash.get(animal.speciesRef);

    return {
      id: animal.id,
      hash: animal._hash,
      name: animal.name,
      speciesId: species?.id ?? null,
      speciesName: species?.name ?? null,
      bornOn: animal.bornOn,
      priceCents: animal.priceCents,
      backgroundStory: animal.backgroundStory,
      traits: resolveTraits(animal.traitsRefs, traitsByHash),
    };
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
