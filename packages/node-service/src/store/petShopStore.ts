import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route, type ComponentsTable } from '@rljson/rljson';
import {
  speciesInsertHistoryTableCfg,
  speciesSeed,
  speciesTableCfg,
  type HashedSpeciesRow,
} from '@rljson-tryout/domain';

const speciesRoute = Route.fromFlat(speciesTableCfg.key);

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
    for (const tableCfg of [speciesTableCfg, speciesInsertHistoryTableCfg]) {
      await this.db.core.createTable(tableCfg);
    }
  }

  /**
   * Inserts the seed species when the species table is empty. Every row is
   * inserted on its own because `Db.insert` records only the first row of a
   * multi-row insert in the InsertHistory. Returns the number of rows
   * inserted, zero when the store already had species.
   */
  async seedIfEmpty(): Promise<number> {
    if ((await this.io.rowCount(speciesTableCfg.key)) > 0) {
      return 0;
    }

    for (const row of speciesSeed) {
      await this.db.insert(speciesRoute, {
        [speciesTableCfg.key]: { _type: 'components', _data: [row] },
      });
    }

    return speciesSeed.length;
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

  async close(): Promise<void> {
    await this.io.close();
  }
}
