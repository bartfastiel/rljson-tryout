import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of a trait as it is written to the `traits` table. The
 * content hash is added by hashing, see `HashedTraitRow`. A trait is a
 * short, reusable character tag (for example "hoards shiny objects") that
 * an animal can carry zero or more of through `animals.traitsRefs`.
 */
export type TraitRow = {
  id: string;
  name: string;
  description: string;
};

/**
 * A trait row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedTraitRow = Hashed<TraitRow>;

const stringColumn = (
  key: keyof TraitRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `traits` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of a trait across versions.
 * `animals.traitsRefs` references rows of this table as a `jsonArray`
 * multi-reference (`docs/findings/db-basics.md`, "Multi-references").
 */
export const traitsTableCfg: TableCfg = {
  key: 'traits',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    stringColumn('name', 'Name', 'Name'),
    stringColumn('description', 'Description', 'Description'),
  ],
};

/**
 * The InsertHistory companion of the `traits` table. Every insert into
 * `traits` writes one row here, which is how versions are ordered later.
 */
export const traitsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(traitsTableCfg);
