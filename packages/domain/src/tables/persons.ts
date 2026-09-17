import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of a person as it is written to the `persons` table. The
 * content hash is added by hashing, see `HashedPersonRow`. A person is the
 * shared identity behind a breeder (this slice, B7) and, later, a customer
 * (slice B8): this table stays person-only, and `breeders` and `customers`
 * each reference it through their own `personRef`.
 */
export type PersonRow = {
  id: string;
  name: string;
  street: string;
  city: string;
  email: string;
};

/**
 * A person row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedPersonRow = Hashed<PersonRow>;

const stringColumn = (
  key: keyof PersonRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `persons` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of a person across versions.
 */
export const personsTableCfg: TableCfg = {
  key: 'persons',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    stringColumn('name', 'Name', 'Name'),
    stringColumn('street', 'Street', 'Street'),
    stringColumn('city', 'City', 'City'),
    stringColumn('email', 'Email', 'Email'),
  ],
};

/**
 * The InsertHistory companion of the `persons` table. Every insert into
 * `persons` writes one row here, which is how versions are ordered later.
 */
export const personsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(personsTableCfg);
