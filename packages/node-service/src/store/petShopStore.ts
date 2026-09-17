import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route, type ComponentsTable } from '@rljson/rljson';
import {
  animalTraitsInsertHistoryTableCfg,
  animalTraitsSeed,
  animalTraitsTableCfg,
  animalsInsertHistoryTableCfg,
  animalsSeed,
  animalsTableCfg,
  breedersInsertHistoryTableCfg,
  breedersSeed,
  breedersTableCfg,
  personsInsertHistoryTableCfg,
  personsSeed,
  personsTableCfg,
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  traitsInsertHistoryTableCfg,
  traitsSeed,
  traitsTableCfg,
  type HashedAnimalRow,
  type HashedAnimalTraitRow,
  type HashedBreederRow,
  type HashedPersonRow,
  type HashedSpeciesRow,
  type HashedTraitRow,
} from '@rljson-tryout/domain';

import {
  JunctionTraitRelation,
  MultiReferenceTraitRelation,
  type TraitRelation,
  type TraitRelationMode,
} from './traitRelation.ts';

const speciesRoute = Route.fromFlat(speciesTableCfg.key);
const animalsRoute = Route.fromFlat(animalsTableCfg.key);
const traitsRoute = Route.fromFlat(traitsTableCfg.key);
const personsRoute = Route.fromFlat(personsTableCfg.key);
const breedersRoute = Route.fromFlat(breedersTableCfg.key);
const animalTraitsRoute = Route.fromFlat(animalTraitsTableCfg.key);

/**
 * One trait as an animal carries it, resolved through the configured
 * `TraitRelation` to the trait's stable `id` and current `name`. Used both
 * by `PetShopStore.listTraits` (every trait in the store) and as the shape
 * of `AnimalDetail.traits` (the traits one animal carries).
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
 * The person behind a breeder, as `PetShopStore.listBreeders` joins it in:
 * just the fields roadmap section 2.5's `GET /api/breeders` documents,
 * never the street or email a breeder card has no use for. `null` for the
 * store-integrity case of a breeder whose `personRef` does not resolve to a
 * person in the store, the same tolerance `AnimalWithSpecies.speciesName`
 * already has for a dangling `speciesRef`.
 */
export type BreederPerson = {
  id: string;
  name: string;
  city: string;
};

/**
 * One breeder version as `PetShopStore.listBreeders` returns it, in the
 * shape `GET /api/breeders` serves (roadmap section 2.5): the full
 * `breeders` row plus its `_hash` and the person it belongs to, already
 * joined.
 */
export type Breeder = {
  id: string;
  hash: string;
  farmName: string;
  suppliesSince: string;
  person: BreederPerson | null;
};

/**
 * The breeder behind an animal, as `PetShopStore.getAnimal` joins it in for
 * the detail view's facts block: the breeder's own `id` and `farmName` plus
 * the supplying person's `name` (as `personName`) and `city`. `personName`
 * and `city` are `null` when the breeder's own `personRef` does not resolve,
 * the same tolerance `BreederPerson` already has.
 */
export type AnimalBreeder = {
  id: string;
  farmName: string;
  personName: string | null;
  city: string | null;
};

/**
 * One animal as `PetShopStore.listAnimals` returns it: the fields a caller
 * needs to show a card, with the referenced species and breeder already
 * resolved so the caller never has to look `speciesRef` or `breederRef` up
 * itself. `speciesId`, `speciesName`, `breederId` and `breederFarmName` are
 * `null` for the store-integrity case of an animal whose reference does not
 * resolve to a row in the store, rather than the method failing the whole
 * list for one broken row. Traits are used to filter this list
 * (`AnimalFilter.traitId`) but never appear in it themselves, so the list
 * stays as light as `backgroundStory` already keeps it; only `AnimalDetail`
 * carries them, and only `AnimalDetail` carries the full breeder (person
 * name and city included), per roadmap section 2.5.
 */
export type AnimalWithSpecies = {
  id: string;
  hash: string;
  name: string;
  speciesId: string | null;
  speciesName: string | null;
  breederId: string | null;
  breederFarmName: string | null;
  bornOn: string;
  priceCents: number;
};

/**
 * Narrows a filter for `listAnimals` to the animals of one species, one
 * breeder and, or, one trait. All three narrow the same list and combine
 * with a logical AND.
 */
export type AnimalFilter = {
  speciesId?: string;
  breederId?: string;
  traitId?: string;
};

/**
 * One animal as `PetShopStore.getAnimal` returns it: everything
 * `AnimalWithSpecies` has, plus the full `backgroundStory`, the traits this
 * animal carries (resolved to their `id` and `name` through the configured
 * `TraitRelation`) and its breeder (resolved to `id`, `farmName`, the
 * supplying person's name and city). `GET /api/animals` never includes
 * these fields so that the list stays light; only the detail endpoint does
 * (roadmap section 2.5). A trait reference that does not resolve to a
 * stored trait is left out of `traits` rather than failing the whole
 * request, the same tolerance `speciesId` and `speciesName` already have
 * for a dangling `speciesRef`; `breeder` is `null` for the same reason when
 * `breederRef` does not resolve to a breeder in the store.
 */
export type AnimalDetail = AnimalWithSpecies & {
  backgroundStory: string;
  traits: TraitSummary[];
  breeder: AnimalBreeder | null;
};

/**
 * Resolves a breeder row's `personRef` hash to the person it currently
 * points at, the shape `PetShopStore.listBreeders` joins into
 * `Breeder.person`. `null` when the reference does not resolve, the same
 * tolerance a dangling `speciesRef` already gets.
 */
const resolveBreederPerson = (
  breeder: HashedBreederRow,
  personsByHash: Map<string, HashedPersonRow>,
): BreederPerson | null => {
  const person = personsByHash.get(breeder.personRef);
  return person === undefined
    ? null
    : { id: person.id, name: person.name, city: person.city };
};

/**
 * Resolves an animal row's `breederRef` hash to the breeder it currently
 * points at, with that breeder's own `personRef` resolved one step further
 * for the detail view's facts block (`AnimalDetail.breeder`). `null` when
 * `breederRef` itself does not resolve, the same tolerance a dangling
 * `speciesRef` already gets; `personName` and `city` are `null` when the
 * breeder resolves but its own `personRef` does not.
 */
const resolveAnimalBreeder = (
  breederRef: string,
  breedersByHash: Map<string, HashedBreederRow>,
  personsByHash: Map<string, HashedPersonRow>,
): AnimalBreeder | null => {
  const breeder = breedersByHash.get(breederRef);
  if (breeder === undefined) {
    return null;
  }

  const person = resolveBreederPerson(breeder, personsByHash);
  return {
    id: breeder.id,
    farmName: breeder.farmName,
    personName: person?.name ?? null,
    city: person?.city ?? null,
  };
};

/**
 * The node's data: an rljson `Db` over an in-memory `IoMem`. Later slices
 * put SQLite and SQL Server behind the same `Db`. `animalTraits` (the
 * junction-table alternative to `animals.traitsRefs`, slice B6) is always
 * created and seeded, regardless of `traitRelationMode`: the table is part
 * of the domain either way, and switching the mode at runtime must not
 * require reseeding (`docs/findings/n-to-m.md`).
 */
export class PetShopStore {
  private readonly io = new IoMem();
  private readonly db = new Db(this.io);
  private readonly traitRelationMode: TraitRelationMode;

  constructor(
    options: Readonly<{ traitRelationMode?: TraitRelationMode }> = {},
  ) {
    this.traitRelationMode = options.traitRelationMode ?? 'multi-reference';
  }

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
      personsTableCfg,
      personsInsertHistoryTableCfg,
      breedersTableCfg,
      breedersInsertHistoryTableCfg,
      animalsTableCfg,
      animalsInsertHistoryTableCfg,
      animalTraitsTableCfg,
      animalTraitsInsertHistoryTableCfg,
    ]) {
      await this.db.core.createTable(tableCfg);
    }
  }

  /**
   * Inserts the seed species, the seed traits, the seed persons, the seed
   * breeders, once all four are in place the seed animals, and finally the
   * derived `animalTraits` junction rows, skipping a step when its table
   * already holds rows. Animals reference species, breeders and traits by
   * hash, breeders reference persons by hash, and `animalTraits` rows
   * reference animals and traits by hash in turn, so every table a later
   * one points at is always seeded first. Every row is inserted on its own
   * because `Db.insert` records only the first row of a multi-row insert in
   * the InsertHistory.
   */
  async seedIfEmpty(): Promise<{
    speciesSeeded: number;
    traitsSeeded: number;
    personsSeeded: number;
    breedersSeeded: number;
    animalsSeeded: number;
    animalTraitsSeeded: number;
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
    const personsSeeded = await this.seedTableIfEmpty(
      personsTableCfg.key,
      personsRoute,
      personsSeed,
    );
    const breedersSeeded = await this.seedTableIfEmpty(
      breedersTableCfg.key,
      breedersRoute,
      breedersSeed,
    );
    const animalsSeeded = await this.seedTableIfEmpty(
      animalsTableCfg.key,
      animalsRoute,
      animalsSeed,
    );
    const animalTraitsSeeded = await this.seedTableIfEmpty(
      animalTraitsTableCfg.key,
      animalTraitsRoute,
      animalTraitsSeed,
    );

    return {
      speciesSeeded,
      traitsSeeded,
      personsSeeded,
      breedersSeeded,
      animalsSeeded,
      animalTraitsSeeded,
    };
  }

  private async seedTableIfEmpty(
    tableKey: string,
    route: Route,
    rows: readonly (
      | HashedSpeciesRow
      | HashedTraitRow
      | HashedPersonRow
      | HashedBreederRow
      | HashedAnimalRow
      | HashedAnimalTraitRow
    )[],
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
   * Reads the tables `listAnimals` and `getAnimal` both need and builds the
   * `TraitRelation` for the configured `traitRelationMode`: in
   * `multi-reference` mode `animals` already carries every animal's trait
   * hashes in `traitsRefs`, so `animalTraits` is not read at all; in
   * `junction` mode `animalTraits` is read as one additional table instead,
   * since the relation lives there rather than on `animals`
   * (`docs/findings/n-to-m.md`, "query shape"). This is the one place
   * `listAnimals` and `getAnimal` depend on which representation is active;
   * both build their answer from the interface `TraitRelation` afterwards,
   * never from `HashedAnimalRow.traitsRefs` or `animalTraits` directly.
   */
  private async readAnimalTables(): Promise<{
    animalsTable: ComponentsTable<HashedAnimalRow>;
    speciesTable: ComponentsTable<HashedSpeciesRow>;
    breedersTable: ComponentsTable<HashedBreederRow>;
    personsTable: ComponentsTable<HashedPersonRow>;
    traitsTable: ComponentsTable<HashedTraitRow>;
    traitRelation: TraitRelation;
  }> {
    if (this.traitRelationMode === 'junction') {
      const [
        { rljson: animalsContainer },
        { rljson: speciesContainer },
        { rljson: breedersContainer },
        { rljson: personsContainer },
        { rljson: traitsContainer },
        { rljson: animalTraitsContainer },
      ] = await Promise.all([
        this.db.get(animalsRoute, {}),
        this.db.get(speciesRoute, {}),
        this.db.get(breedersRoute, {}),
        this.db.get(personsRoute, {}),
        this.db.get(traitsRoute, {}),
        this.db.get(animalTraitsRoute, {}),
      ]);
      const animalsTable = animalsContainer[
        animalsTableCfg.key
      ] as ComponentsTable<HashedAnimalRow>;
      const speciesTable = speciesContainer[
        speciesTableCfg.key
      ] as ComponentsTable<HashedSpeciesRow>;
      const breedersTable = breedersContainer[
        breedersTableCfg.key
      ] as ComponentsTable<HashedBreederRow>;
      const personsTable = personsContainer[
        personsTableCfg.key
      ] as ComponentsTable<HashedPersonRow>;
      const traitsTable = traitsContainer[
        traitsTableCfg.key
      ] as ComponentsTable<HashedTraitRow>;
      const animalTraitsTable = animalTraitsContainer[
        animalTraitsTableCfg.key
      ] as ComponentsTable<HashedAnimalTraitRow> | undefined;

      return {
        animalsTable,
        speciesTable,
        breedersTable,
        personsTable,
        traitsTable,
        traitRelation: new JunctionTraitRelation(
          animalTraitsTable?._data ?? [],
          traitsTable._data,
        ),
      };
    }

    const [
      { rljson: animalsContainer },
      { rljson: speciesContainer },
      { rljson: breedersContainer },
      { rljson: personsContainer },
      { rljson: traitsContainer },
    ] = await Promise.all([
      this.db.get(animalsRoute, {}),
      this.db.get(speciesRoute, {}),
      this.db.get(breedersRoute, {}),
      this.db.get(personsRoute, {}),
      this.db.get(traitsRoute, {}),
    ]);
    const animalsTable = animalsContainer[
      animalsTableCfg.key
    ] as ComponentsTable<HashedAnimalRow>;
    const speciesTable = speciesContainer[
      speciesTableCfg.key
    ] as ComponentsTable<HashedSpeciesRow>;
    const breedersTable = breedersContainer[
      breedersTableCfg.key
    ] as ComponentsTable<HashedBreederRow>;
    const personsTable = personsContainer[
      personsTableCfg.key
    ] as ComponentsTable<HashedPersonRow>;
    const traitsTable = traitsContainer[
      traitsTableCfg.key
    ] as ComponentsTable<HashedTraitRow>;

    return {
      animalsTable,
      speciesTable,
      breedersTable,
      personsTable,
      traitsTable,
      traitRelation: new MultiReferenceTraitRelation(
        animalsTable._data,
        traitsTable._data,
      ),
    };
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
   * Every breeder version in the store with its person joined, ordered by
   * `id`, in the shape `GET /api/breeders` serves (roadmap section 2.5).
   * Fetches `breeders` and `persons` separately and joins them with a local
   * `Map`, the same explicit fallback `listAnimals` uses for `species`
   * (`docs/findings/db-basics.md`, "Joining a reference"). A breeder whose
   * `personRef` does not resolve gets `person: null` instead of failing the
   * whole list.
   */
  async listBreeders(): Promise<Breeder[]> {
    const [{ rljson: breedersContainer }, { rljson: personsContainer }] =
      await Promise.all([
        this.db.get(breedersRoute, {}),
        this.db.get(personsRoute, {}),
      ]);
    const breedersTable = breedersContainer[
      breedersTableCfg.key
    ] as ComponentsTable<HashedBreederRow>;
    const personsTable = personsContainer[
      personsTableCfg.key
    ] as ComponentsTable<HashedPersonRow>;
    const personsByHash = new Map(
      personsTable._data.map((person) => [person._hash, person]),
    );

    return [...breedersTable._data]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((breeder) => ({
        id: breeder.id,
        hash: breeder._hash,
        farmName: breeder.farmName,
        suppliesSince: breeder.suppliesSince,
        person: resolveBreederPerson(breeder, personsByHash),
      }));
  }

  /**
   * Every animal version in the store with its species and breeder joined,
   * optionally narrowed to one species, one breeder, one trait, or any
   * combination, ordered by `id`. Fetches `animals`, `species`, `breeders`,
   * `persons` and `traits` (and, in `junction` mode, `animalTraits`)
   * separately and joins them with local `Map`s, the explicit fallback of
   * roadmap section 3.2: the rljson route join `animals/species` was tried
   * first, but it silently drops an animal row whose `speciesRef` does not
   * resolve instead of including it with a missing species, which defeats
   * listing every animal (`docs/findings/db-basics.md`, "Joining a
   * reference"). Filtering happens here, in plain JavaScript, after this
   * full read, for the same reason `getAnimal` cannot filter `db.get` by
   * `where`: `id` collides with a column of a *referenced* table and is
   * silently mismatched by `ComponentController`'s reference resolution
   * (`docs/findings/db-basics.md`, "Filtering by id"), and `traitId` would
   * have to be resolved element by element against whichever table carries
   * the relation besides, a shape `where` cannot express at all. An unknown
   * `speciesId`, `breederId` or `traitId` filter yields an empty list rather
   * than an error. An animal whose `speciesRef` or `breederRef` does not
   * resolve (nothing writes one today; `Db.insert` and `IoMem` do not check
   * references, only `Validate` does, see the finding above) gets the
   * matching fields `null` instead of failing the whole list; an animal
   * that does not carry the filtered trait, according to the configured
   * `TraitRelation`, simply does not match.
   */
  async listAnimals(filter: AnimalFilter = {}): Promise<AnimalWithSpecies[]> {
    const { animalsTable, speciesTable, breedersTable, traitsTable, traitRelation } =
      await this.readAnimalTables();
    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const breedersByHash = new Map(
      breedersTable._data.map((breeder) => [breeder._hash, breeder]),
    );
    const traitHashById = new Map(
      traitsTable._data.map((trait) => [trait.id, trait._hash]),
    );

    let matchingAnimalHashes: Set<string> | undefined;
    if (filter.traitId !== undefined) {
      const traitHash = traitHashById.get(filter.traitId);
      const animalHashes =
        traitHash === undefined
          ? []
          : traitRelation.animalHashesWithTrait(traitHash);
      matchingAnimalHashes = new Set(animalHashes);
    }

    const matchesFilter = (animal: HashedAnimalRow): boolean => {
      if (filter.speciesId !== undefined) {
        const species = speciesByHash.get(animal.speciesRef);
        if (species?.id !== filter.speciesId) {
          return false;
        }
      }
      if (filter.breederId !== undefined) {
        const breeder = breedersByHash.get(animal.breederRef);
        if (breeder?.id !== filter.breederId) {
          return false;
        }
      }
      if (matchingAnimalHashes !== undefined) {
        if (!matchingAnimalHashes.has(animal._hash)) {
          return false;
        }
      }
      return true;
    };

    const entries = animalsTable._data.filter(matchesFilter).map((animal) => {
      const species = speciesByHash.get(animal.speciesRef);
      const breeder = breedersByHash.get(animal.breederRef);

      return {
        id: animal.id,
        hash: animal._hash,
        name: animal.name,
        speciesId: species?.id ?? null,
        speciesName: species?.name ?? null,
        breederId: breeder?.id ?? null,
        breederFarmName: breeder?.farmName ?? null,
        bornOn: animal.bornOn,
        priceCents: animal.priceCents,
      };
    });

    return entries.sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * The current version of one animal with its species and breeder joined,
   * its traits resolved and its full `backgroundStory`, or `undefined` when
   * no animal has this id.
   *
   * Filtering `db.get(animalsRoute, { id })` directly looks like the obvious
   * approach (`docs/findings/db-basics.md`, "Get") and works for columns
   * such as `bornOn`, but not for `id`: `ComponentController._referenceColumns`
   * resolves to the *referenced* table's columns instead of the referencing
   * table's own ref columns, so a `where` key that happens to also be a
   * column of a referenced table (`id`, `name`, `_hash`) is wrongly treated
   * as a foreign-key lookup and matches nothing (see "Filtering by id" in
   * `docs/findings/db-basics.md`). This method therefore reuses
   * `listAnimals`'s explicit fallback instead: read every table in full and
   * join them with local `Map`s, then find the animal by `id` in
   * JavaScript. An animal whose `speciesRef` does not resolve gets
   * `speciesId` and `speciesName` of `null`, the same tolerance
   * `listAnimals` has; a trait the configured `TraitRelation` cannot resolve
   * to a stored trait is simply left out of `traits`; a `breederRef` that
   * does not resolve gives `breeder: null` (see `resolveAnimalBreeder`).
   */
  async getAnimal(id: string): Promise<AnimalDetail | undefined> {
    const {
      animalsTable,
      speciesTable,
      breedersTable,
      personsTable,
      traitsTable,
      traitRelation,
    } = await this.readAnimalTables();

    const animal = animalsTable._data.find((row) => row.id === id);
    if (animal === undefined) {
      return undefined;
    }

    const speciesByHash = new Map(
      speciesTable._data.map((species) => [species._hash, species]),
    );
    const breedersByHash = new Map(
      breedersTable._data.map((breeder) => [breeder._hash, breeder]),
    );
    const personsByHash = new Map(
      personsTable._data.map((person) => [person._hash, person]),
    );
    const traitsById = new Map(
      traitsTable._data.map((trait) => [trait.id, trait]),
    );
    const species = speciesByHash.get(animal.speciesRef);
    const breeder = breedersByHash.get(animal.breederRef);
    const traits: TraitSummary[] = traitRelation
      .traitIdsOfAnimal(animal._hash)
      .map((traitId) => traitsById.get(traitId))
      .filter((trait): trait is HashedTraitRow => trait !== undefined)
      .map((trait) => ({ id: trait.id, name: trait.name }));

    return {
      id: animal.id,
      hash: animal._hash,
      name: animal.name,
      speciesId: species?.id ?? null,
      speciesName: species?.name ?? null,
      breederId: breeder?.id ?? null,
      breederFarmName: breeder?.farmName ?? null,
      bornOn: animal.bornOn,
      priceCents: animal.priceCents,
      backgroundStory: animal.backgroundStory,
      traits,
      breeder: resolveAnimalBreeder(
        animal.breederRef,
        breedersByHash,
        personsByHash,
      ),
    };
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
