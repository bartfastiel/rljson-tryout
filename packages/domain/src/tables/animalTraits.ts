import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One row of the `animalTraits` junction table: one animal carrying one
 * trait, as an alternative to `animals.traitsRefs` (slice B5's `jsonArray`
 * multi-reference) for the same n-to-m relation. `id` is the deterministic
 * slug `<animalId>--<traitId>` (see `seed/animalTraits.ts`); `animalRef` and
 * `traitRef` are the `_hash` of the referenced `animals` and `traits`
 * version, matching the `<table>Ref` convention of every other reference
 * column (roadmap section 2.6).
 */
export type AnimalTraitRow = {
  id: string;
  animalRef: string;
  traitRef: string;
};

/**
 * An `animalTraits` row as it is stored and served: the row plus its
 * `_hash`, which identifies this exact version across every node.
 */
export type HashedAnimalTraitRow = Hashed<AnimalTraitRow>;

const stringColumn = (
  key: keyof AnimalTraitRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `animalTraits` table from roadmap section 2.6: the junction-table
 * alternative to `animals.traitsRefs`, compared in `docs/findings/n-to-m.md`.
 * It is a root table like `animals` and `traits`: it has no parent, and `id`
 * is the stable identity of one animal-trait pairing across versions.
 * `animalRef` and `traitRef` are reference columns; the rljson validator
 * resolves each against its target table and reports a dangling value as a
 * broken reference, the same mechanism that already guards `speciesRef` and
 * `traitsRefs` (`docs/findings/db-basics.md`, "Joining a reference" and
 * "Multi-references").
 */
export const animalTraitsTableCfg: TableCfg = {
  key: 'animalTraits',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    {
      key: 'animalRef',
      type: 'string',
      titleLong: 'Animal reference',
      titleShort: 'Animal',
      ref: { tableKey: 'animals', type: 'components' },
    },
    {
      key: 'traitRef',
      type: 'string',
      titleLong: 'Trait reference',
      titleShort: 'Trait',
      ref: { tableKey: 'traits', type: 'components' },
    },
  ],
};

/**
 * The InsertHistory companion of the `animalTraits` table. Every insert into
 * `animalTraits` writes one row here, which is how versions are ordered
 * later.
 */
export const animalTraitsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(animalTraitsTableCfg);
