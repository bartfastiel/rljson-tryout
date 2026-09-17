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
  type HashedAnimalRow,
  type HashedSpeciesRow,
} from '@rljson-tryout/domain';

const speciesRoute = Route.fromFlat(speciesTableCfg.key);
const animalsRoute = Route.fromFlat(animalsTableCfg.key);
const animalsWithSpeciesRoute = Route.fromFlat(
  `${animalsTableCfg.key}/${speciesTableCfg.key}`,
);

/**
 * One animal as `PetShopStore.listAnimals` returns it: the fields a caller
 * needs to show a card, with the referenced species already resolved to its
 * `id` and `name` so the caller never has to look `speciesRef` up itself.
 */
export type AnimalWithSpecies = {
  id: string;
  hash: string;
  name: string;
  speciesId: string;
  speciesName: string;
  bornOn: string;
  priceCents: number;
};

/**
 * Narrows a filter for `listAnimals` to the animals of one species.
 */
export type AnimalFilter = {
  speciesId?: string;
};

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
      animalsTableCfg,
      animalsInsertHistoryTableCfg,
    ]) {
      await this.db.core.createTable(tableCfg);
    }
  }

  /**
   * Inserts the seed species and, once they are in place, the seed animals,
   * skipping either step when its table already holds rows. Animals
   * reference species by hash, so species are always seeded first. Every
   * row is inserted on its own because `Db.insert` records only the first
   * row of a multi-row insert in the InsertHistory.
   */
  async seedIfEmpty(): Promise<{
    speciesSeeded: number;
    animalsSeeded: number;
  }> {
    const speciesSeeded = await this.seedTableIfEmpty(
      speciesTableCfg.key,
      speciesRoute,
      speciesSeed,
    );
    const animalsSeeded = await this.seedTableIfEmpty(
      animalsTableCfg.key,
      animalsRoute,
      animalsSeed,
    );

    return { speciesSeeded, animalsSeeded };
  }

  private async seedTableIfEmpty(
    tableKey: string,
    route: Route,
    rows: readonly (HashedSpeciesRow | HashedAnimalRow)[],
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
   * Every animal version in the store with its species joined, optionally
   * narrowed to one species, ordered by `id`. The join is one `Db.get` call
   * over the route `animals/species` (roadmap section 3.2): a reference
   * segment resolves `speciesRef` on every animal row and the response
   * carries both the `animals` and the referenced `species` rows in one
   * container (`docs/findings/db-basics.md`, "Joining a reference"). An
   * unknown `speciesId` filter yields an empty list rather than an error.
   */
  async listAnimals(filter: AnimalFilter = {}): Promise<AnimalWithSpecies[]> {
    const { rljson } = await this.db.get(animalsWithSpeciesRoute, {});
    const animalsTable = rljson[
      animalsTableCfg.key
    ] as ComponentsTable<HashedAnimalRow>;
    // An empty animals table resolves no reference, so the join leaves the
    // species table out of the response entirely instead of returning it
    // empty; treat both the same way.
    const speciesTable = rljson[speciesTableCfg.key] as
      ComponentsTable<HashedSpeciesRow> | undefined;
    const speciesByHash = new Map(
      (speciesTable?._data ?? []).map((species) => [species._hash, species]),
    );

    const entries = animalsTable._data.map((animal) => {
      const species = speciesByHash.get(animal.speciesRef);
      if (species === undefined) {
        throw new Error(
          `Animal "${animal.id}" references a species that is not in the store.`,
        );
      }

      return {
        id: animal.id,
        hash: animal._hash,
        name: animal.name,
        speciesId: species.id,
        speciesName: species.name,
        bornOn: animal.bornOn,
        priceCents: animal.priceCents,
      };
    });

    const filtered =
      filter.speciesId === undefined
        ? entries
        : entries.filter((entry) => entry.speciesId === filter.speciesId);

    return filtered.sort((left, right) => left.id.localeCompare(right.id));
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
