import type { Hashed } from '@rljson/hash';
import {
  createInsertHistoryTableCfg,
  type ColumnCfg,
  type TableCfg,
} from '@rljson/rljson';

/**
 * One version of a species as it is written to the `species` table. The
 * content hash is added by hashing, see `HashedSpeciesRow`.
 */
export type SpeciesRow = {
  id: string;
  name: string;
  latinName: string;
  description: string;
  /**
   * The id of the species image in the node's blob store (`@rljson/bs`):
   * the content hash of the PNG bytes, which `speciesImageBlobId` computes
   * from the species id before any store has seen the image.
   */
  imageBlobId: string;
  imageMimeType: string;
};

/**
 * A species row as it is stored and served: the row plus its `_hash`, which
 * identifies this exact version across every node.
 */
export type HashedSpeciesRow = Hashed<SpeciesRow>;

const stringColumn = (
  key: keyof SpeciesRow | '_hash',
  titleLong: string,
  titleShort: string,
): ColumnCfg => ({ key, type: 'string', titleLong, titleShort });

/**
 * The `species` table from roadmap section 2.6. It is a root table: it has
 * no parent and `id` is the stable identity of a species across versions.
 */
export const speciesTableCfg: TableCfg = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    stringColumn('_hash', 'Hash', 'Hash'),
    stringColumn('id', 'Identifier', 'Id'),
    stringColumn('name', 'Name', 'Name'),
    stringColumn('latinName', 'Latin name', 'Latin'),
    stringColumn('description', 'Description', 'Description'),
    stringColumn('imageBlobId', 'Image blob id', 'Image'),
    stringColumn('imageMimeType', 'Image media type', 'Image type'),
  ],
};

/**
 * The InsertHistory companion of the `species` table. Every insert into
 * `species` writes one row here, which is how versions are ordered later.
 */
export const speciesInsertHistoryTableCfg: TableCfg =
  createInsertHistoryTableCfg(speciesTableCfg);
