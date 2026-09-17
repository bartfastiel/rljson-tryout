import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One row a change set names: the table it was written to and the `_hash`
 * of the row. This is the item shape of an rljson `Buffet`
 * (`@rljson/rljson`, `content/buffet.ts`), spelled out here so the domain
 * never depends on the library's `Buffet` interface directly.
 */
export type ChangeSetItem = {
  table: string;
  ref: string;
};

/**
 * One change set as it is written to the `changeSets` table: one logical
 * change (an invoice with its items, later a new animal version) as the
 * list of every row it wrote, domain rows and their InsertHistory rows
 * alike (roadmap section 3.4, `docs/findings/change-sets.md`). The content
 * hash is added by hashing, see `HashedChangeSetRow`, and is what a node
 * announces to its peers: whoever holds the change set can pull every
 * item by table and hash.
 */
export type ChangeSetRow = {
  id: string;
  items: ChangeSetItem[];
};

/**
 * A change set row as it is stored and served: the row plus its `_hash`,
 * the identity of this change set across every node.
 */
export type HashedChangeSetRow = Hashed<ChangeSetRow>;

const stringColumn = (
  key: keyof ChangeSetRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `changeSets` table from roadmap section 3.4: an rljson `buffets`
 * table rather than a `components` table, because a buffet is exactly
 * "a collection of arbitrary but related items" named by table and hash,
 * and the rljson validator checks a buffet's items against the document
 * the way it checks a reference column. rljson ships no factory for a
 * buffets table configuration (unlike `createCakeTableCfg` or
 * `createLayerTableCfg`), so the columns are spelled out here: `items`
 * is a `jsonArray` because a buffet's items are a list of objects. The
 * table is a root table with an `id` so that a change set can carry a
 * readable name (`issue-invoice-2026-0001`) next to its hash.
 */
export const changeSetsTableCfg: TableCfg = {
  key: 'changeSets',
  type: 'buffets',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    {
      key: 'items',
      type: 'jsonArray',
      titleLong: 'Items',
      titleShort: 'Items',
    },
  ],
};

/**
 * The InsertHistory companion of the `changeSets` table. One row per
 * change set, which is what orders change sets on a node and lets a late
 * joiner ask for the latest one (slice D4).
 */
export const changeSetsInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(changeSetsTableCfg);
