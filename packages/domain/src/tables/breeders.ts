import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of a breeder as it is written to the `breeders` table. The
 * content hash is added by hashing, see `HashedBreederRow`. `personRef` is
 * the `_hash` of the referenced row in the `persons` table: the person that
 * runs this breeding operation at the time this row was written.
 * `suppliesSince` is an ISO date (`YYYY-MM-DD`), the same shape
 * `animals.bornOn` already uses.
 */
export type BreederRow = {
  id: string;
  personRef: string;
  farmName: string;
  suppliesSince: string;
};

/**
 * A breeder row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedBreederRow = Hashed<BreederRow>;

const stringColumn = (
  key: keyof BreederRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `breeders` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of a breeder across versions,
 * the same pattern `animals` already follows for a table that itself
 * carries a reference column (`personRef`).
 */
export const breedersTableCfg: TableCfg = {
  key: 'breeders',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    {
      key: 'personRef',
      type: 'string',
      titleLong: 'Person reference',
      titleShort: 'Person',
      ref: { tableKey: 'persons', type: 'components' },
    },
    stringColumn('farmName', 'Farm name', 'Farm'),
    stringColumn('suppliesSince', 'Supplies since', 'Since'),
  ],
};

/**
 * The InsertHistory companion of the `breeders` table. Every insert into
 * `breeders` writes one row here, which is how versions are ordered later.
 */
export const breedersInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(breedersTableCfg);
