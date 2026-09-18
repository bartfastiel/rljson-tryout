import { speciesTableCfg } from './species.ts';

/**
 * The columns of the domain tables that name a blob in the node's blob
 * store (`@rljson/bs`) rather than a row: today only `species.imageBlobId`
 * (roadmap section 2.6). A `TableCfg` of `@rljson/rljson` 0.0.81 marks
 * reference columns to other tables (`ref`) but has no marker for a blob
 * id, so the knowledge lives here, next to the tables, and the blob
 * synchronisation of slice D5 reads it to pull the blobs a received row
 * names after the row itself.
 */
const blobReferenceColumns: ReadonlyMap<string, readonly string[]> = new Map([
  [speciesTableCfg.key, ['imageBlobId']],
]);

/** The blob id columns of a table, an empty list for a table without any. */
export const blobReferenceColumnsOf = (tableKey: string): readonly string[] =>
  blobReferenceColumns.get(tableKey) ?? [];

/**
 * The blob ids a row of the given table names, each once, in column
 * order: the string values of its blob id columns. Values of another
 * shape yield nothing rather than an error, since a row may come from
 * another node.
 */
export const blobReferencesOf = (
  tableKey: string,
  row: Readonly<Record<string, unknown>>,
): string[] => {
  const blobIds: string[] = [];
  for (const column of blobReferenceColumnsOf(tableKey)) {
    const value = row[column];
    if (typeof value === 'string' && value !== '' && !blobIds.includes(value)) {
      blobIds.push(value);
    }
  }
  return blobIds;
};
