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
 * `breederRef` is the `_hash` of the referenced row in the `breeders`
 * table: the breeder version that supplied this animal at the time this row
 * was written. `backgroundStory` is free-form English text of any length;
 * slice B4 is what proves a multi-thousand-character value round-trips
 * through the store and the HTTP API unchanged. `traitsRefs` holds the
 * `_hash` of every `traits` row this animal carries at the time this row
 * was written: a `jsonArray` multi-reference (`docs/findings/db-basics.md`,
 * "Multi-references").
 */
export type AnimalRow = {
  id: string;
  name: string;
  speciesRef: string;
  breederRef: string;
  bornOn: string;
  priceCents: number;
  backgroundStory: string;
  traitsRefs: string[];
};

/**
 * An animal row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedAnimalRow = Hashed<AnimalRow>;

/**
 * The `traitsRefs` value for a set of traits: their hashes ordered by trait
 * `id`. The order of traits carries no meaning, but it is part of the row's
 * content and therefore of its hash, so one canonical order makes the same
 * set of traits hash the same wherever the row is built: in the seed, in
 * an edit that names the traits, and in an edit that keeps them, whichever
 * `TraitRelation` the node reads them through (`docs/findings/n-to-m.md`).
 */
export const traitsRefsOf = (
  traits: readonly { id: string; _hash: string }[],
): string[] =>
  [...traits]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((trait) => trait._hash);

const stringColumn = (
  key: keyof AnimalRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `animals` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of an animal across versions.
 * `speciesRef`, `breederRef` and `traitsRefs` are reference columns: the
 * rljson validator resolves each against its target table and reports a
 * dangling value as a broken reference, one element at a time for the
 * `jsonArray` column `traitsRefs`
 * (`docs/findings/db-basics.md`, "Multi-references").
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
    {
      key: 'breederRef',
      type: 'string',
      titleLong: 'Breeder reference',
      titleShort: 'Breeder',
      ref: { tableKey: 'breeders', type: 'components' },
    },
    stringColumn('bornOn', 'Born on', 'Born'),
    {
      key: 'priceCents',
      type: 'number',
      titleLong: 'Price in cents',
      titleShort: 'Price',
    },
    stringColumn('backgroundStory', 'Background story', 'Story'),
    {
      key: 'traitsRefs',
      type: 'jsonArray',
      titleLong: 'Trait references',
      titleShort: 'Traits',
      ref: { tableKey: 'traits', type: 'components' },
    },
  ],
};

/**
 * The InsertHistory companion of the `animals` table. Every insert into
 * `animals` writes one row here, which is how versions are ordered later.
 */
export const animalsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(animalsTableCfg);
