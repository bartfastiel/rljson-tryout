import type { TableCfg } from '@rljson/rljson';
import { changeSetsTableCfg } from '@rljson-tryout/domain';

import type { SyncRow } from '../store/petShopStore.ts';

/** A row another row points at: by table and `_hash`. */
export type RowReference = Readonly<{ table: string; hash: string }>;

/**
 * An InsertHistory row another history row points at through `previous`:
 * by the entity table (the history table is derived) and `timeId`.
 */
export type HistoryReference = Readonly<{ table: string; timeId: string }>;

export type RowReferences = Readonly<{
  rows: RowReference[];
  history: HistoryReference[];
}>;

const historyTableSuffix = 'InsertHistory';

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Every row and history row the given row depends on, read off the table
 * configurations: for a domain row the values of its reference columns
 * (`ref: { tableKey }` in the `TableCfg`, a single hash in a `string`
 * column, a list of hashes in a `jsonArray` column); for an InsertHistory
 * row the row it was written for (`<table>Ref`) and the versions it
 * supersedes (`previous`, `timeId`s of the same history table). A
 * `changeSets` row depends on nothing here: its items are what the
 * synchronisation pulls in the first place. Unknown tables and values of
 * the wrong shape yield no references rather than an error, since the
 * row came from another node.
 */
export const referencesOf = (
  tableCfgs: ReadonlyMap<string, TableCfg>,
  table: string,
  row: SyncRow,
): RowReferences => {
  const rows: RowReference[] = [];
  const history: HistoryReference[] = [];

  if (table.endsWith(historyTableSuffix)) {
    const entityTable = table.slice(0, -historyTableSuffix.length);
    if (tableCfgs.has(entityTable) && entityTable !== changeSetsTableCfg.key) {
      const hash = row[`${entityTable}Ref`];
      if (isString(hash)) {
        rows.push({ table: entityTable, hash });
      }
      const previous = row.previous;
      if (Array.isArray(previous)) {
        for (const timeId of previous) {
          if (isString(timeId)) {
            history.push({ table: entityTable, timeId });
          }
        }
      }
    }
    return { rows, history };
  }

  const tableCfg = tableCfgs.get(table);
  if (tableCfg === undefined || tableCfg.key === changeSetsTableCfg.key) {
    return { rows, history };
  }
  for (const column of tableCfg.columns) {
    if (column.ref === undefined) {
      continue;
    }
    const value = row[column.key];
    const hashes = Array.isArray(value) ? value : [value];
    for (const hash of hashes) {
      if (isString(hash)) {
        rows.push({ table: column.ref.tableKey, hash });
      }
    }
  }
  return { rows, history };
};
