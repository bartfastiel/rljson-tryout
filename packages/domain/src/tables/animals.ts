import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of an animal as it is written to the `animals` table. The
 * content hash is added by hashing, see `HashedAnimalRow`. `speciesRef` is
 * the `_hash` of the referenced row in the `species` table: the species
 * version this animal belonged to at the time this row was written.
 * `backgroundStory` is free-form English text of any length; slice B4 is
 * what proves a multi-thousand-character value round-trips through the
 * store and the HTTP API unchanged. This table has no traits yet; that
 * column arrives in slice B5.
 */
export type AnimalRow = {
  id: string;
  name: string;
  speciesRef: string;
  bornOn: string;
  priceCents: number;
  backgroundStory: string;
};

/**
 * An animal row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedAnimalRow = Hashed<AnimalRow>;

const stringColumn = (
  key: keyof AnimalRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `animals` table from roadmap section 2.6, without `breederRef` and
 * `traitsRefs` yet. It is a root table: it has no parent and `id` is the
 * stable identity of an animal across versions. `speciesRef` is a reference
 * column: the rljson validator resolves it against the `species` table and
 * reports a dangling value as a broken reference.
 */
export const animalsTableCfg: TableCfg = {
  key: 'animals',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    stringColumn('name', 'Name', 'Name'),
    {
      key: 'speciesRef',
      type: 'string',
      titleLong: 'Species reference',
      titleShort: 'Species',
      ref: { tableKey: 'species', type: 'components' },
    },
    stringColumn('bornOn', 'Born on', 'Born'),
    {
      key: 'priceCents',
      type: 'number',
      titleLong: 'Price in cents',
      titleShort: 'Price',
    },
    stringColumn('backgroundStory', 'Background story', 'Story'),
  ],
};

/**
 * The InsertHistory companion of the `animals` table. Every insert into
 * `animals` writes one row here, which is how versions are ordered later.
 */
export const animalsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(animalsTableCfg);
