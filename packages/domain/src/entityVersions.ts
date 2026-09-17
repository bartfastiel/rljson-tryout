/**
 * The "current version" rule of roadmap section 2.6, implemented once for
 * every entity table: a row never changes, a change is a new row with a new
 * `_hash` plus an InsertHistory row whose `previous` names the `timeId` of
 * the version it supersedes. The InsertHistory rows of one table therefore
 * form a DAG, and the current version of an entity is the version whose
 * history row is a tip of that DAG (no other row of the same entity names
 * it in `previous`). More than one tip for one entity is a conflict
 * (`docs/findings/entity-versions.md`).
 *
 * rljson's own `Db.detectDagBranch` applies the same tip rule to a whole
 * table, which reports a branch as soon as a table holds two independent
 * entities (`docs/findings/db-basics.md`). This module groups the history
 * rows by entity `id` through the row each one references, so tips are
 * counted per entity, which is what lists, details and conflict detection
 * (slice D11) need.
 */

/**
 * What this module needs of an InsertHistory row: its `timeId`, the
 * `timeId`s it supersedes, and the `<table>Ref` column that names the row
 * it was written for (`animalsRef` for the `animals` table). The column
 * name is derived from the table key by `referenceColumnOf`, matching
 * `createInsertHistoryTableCfg` of `@rljson/rljson`.
 */
export type VersionHistoryRow = {
  timeId: string;
  previous?: readonly string[];
  [referenceColumn: string]: unknown;
};

/**
 * What this module needs of an entity row: its content hash and its stable
 * identity across versions.
 */
export type EntityRow = {
  _hash: string;
  id: string;
};

/**
 * One version of one entity, as `versionsOf` lists them: the row, the
 * `timeId` of the InsertHistory row that wrote it, the `timeId`s that
 * version superseded, and whether it is a tip of the entity's DAG.
 */
export type EntityVersion<Row extends EntityRow> = {
  row: Row;
  timeId: string;
  previous: string[];
  current: boolean;
};

/**
 * The outcome of the rule for a whole table: the current row per entity
 * `id`, and the `id`s whose DAG has more than one tip. A conflicting entity
 * still has a current row in `currentById` (the tip with the newest
 * `timeId`, ties broken by the `timeId`'s unique part), so a list never
 * loses an entity to a conflict; slice D11 surfaces `conflictingIds` to the
 * operator and slice D12 closes the branch with a merge version.
 */
export type CurrentVersions<Row extends EntityRow> = {
  currentById: Map<string, Row>;
  conflictingIds: Set<string>;
};

/**
 * The name of the column an InsertHistory row references its table's row
 * through: `<tableKey>Ref`, the convention `createInsertHistoryTableCfg`
 * of `@rljson/rljson` uses (`animalsRef`, `speciesRef`).
 */
export const referenceColumnOf = (tableKey: string): string => `${tableKey}Ref`;

const timestampOf = (timeId: string): number =>
  Number(timeId.slice(0, timeId.indexOf(':')));

/**
 * The unique parts of two `timeId`s in descending code point order: the
 * greater string first. Code points rather than locale collation, which
 * differs between runtimes and treats `-` and `_` of the nanoid alphabet
 * unevenly.
 */
const descendingByCodePoints = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? 1 : -1;
};

/**
 * Orders two rljson `timeId`s (`<milliseconds since epoch>:<4 unique
 * characters>`) newest first: by timestamp, ties broken by the unique
 * part, so that the order is total and the same on every node.
 */
export const compareTimeIdsNewestFirst = (
  left: string,
  right: string,
): number =>
  timestampOf(right) - timestampOf(left) || descendingByCodePoints(left, right);

/**
 * A history row paired with the entity row it references, the unit the
 * rule reasons about. A version is a history row, not a row: the same row
 * hash can be written twice (an edit that restores earlier content) and
 * then counts as two versions. A history row whose reference resolves to
 * no row in the table says nothing about any entity and is left out; so
 * is a row no history row references, which has no place in the DAG and
 * therefore no version (every write in this project goes through
 * `Db.insert` or writes its history row alongside, so nothing is lost).
 */
type Version<Row extends EntityRow> = {
  row: Row;
  history: VersionHistoryRow;
};

const versionsByEntity = <Row extends EntityRow>(
  rows: readonly Row[],
  historyRows: readonly VersionHistoryRow[],
  tableKey: string,
): Map<string, Version<Row>[]> => {
  const referenceColumn = referenceColumnOf(tableKey);
  const rowsByHash = new Map(rows.map((row) => [row._hash, row]));
  const byEntity = new Map<string, Version<Row>[]>();

  for (const history of historyRows) {
    const row = rowsByHash.get(history[referenceColumn] as string);
    if (row === undefined) {
      continue;
    }
    const versions = byEntity.get(row.id) ?? [];
    versions.push({ row, history });
    byEntity.set(row.id, versions);
  }

  return byEntity;
};

/**
 * How far each version is from the start of its entity's history: one for
 * a version whose `previous` names no version of the entity, one more than
 * the deepest version it supersedes otherwise. Versions written on one
 * node within the same millisecond share a timestamp, so their `timeId`s
 * alone cannot say which came first; their `previous` links can, and the
 * depth is what "newest first" orders by before falling back to the
 * `timeId`. Versions on a cycle (impossible from honest writes) get no
 * depth and rank by `timeId` alone.
 */
const depthsOf = <Row extends EntityRow>(
  versions: readonly Version<Row>[],
): Map<string, number> => {
  const timeIds = new Set(versions.map((version) => version.history.timeId));
  const depths = new Map<string, number>();
  let unresolved = [...versions].sort((left, right) =>
    compareTimeIdsNewestFirst(right.history.timeId, left.history.timeId),
  );

  let resolvedAny = true;
  while (resolvedAny && unresolved.length > 0) {
    resolvedAny = false;
    unresolved = unresolved.filter((version) => {
      const previous = (version.history.previous ?? []).filter((timeId) =>
        timeIds.has(timeId),
      );
      if (!previous.every((timeId) => depths.has(timeId))) {
        return true;
      }
      depths.set(
        version.history.timeId,
        1 + Math.max(0, ...previous.map((timeId) => depths.get(timeId)!)),
      );
      resolvedAny = true;
      return false;
    });
  }

  return depths;
};

/**
 * Orders versions newest first: by depth in the entity's history, then by
 * `timeId`, so that a chain reads in write order even when several
 * versions were written within one millisecond.
 */
const newestFirst = <Row extends EntityRow>(
  versions: readonly Version<Row>[],
  depths: ReadonlyMap<string, number>,
): Version<Row>[] =>
  [...versions].sort(
    (left, right) =>
      (depths.get(right.history.timeId) ?? 0) -
        (depths.get(left.history.timeId) ?? 0) ||
      compareTimeIdsNewestFirst(left.history.timeId, right.history.timeId),
  );

/**
 * The tips of one entity's DAG, newest first: the versions no other
 * version of the entity names in `previous`. History rows only ever name
 * rows written before them, so a cycle cannot arise from honest writes;
 * should one arrive anyway (a hostile peer, slice D14 and later), the
 * newest version counts as the single tip rather than the entity
 * disappearing from every list.
 */
const tipsOf = <Row extends EntityRow>(
  versions: readonly Version<Row>[],
): Version<Row>[] => {
  const superseded = new Set(
    versions.flatMap((version) => version.history.previous ?? []),
  );
  const depths = depthsOf(versions);
  const tips = newestFirst(
    versions.filter((version) => !superseded.has(version.history.timeId)),
    depths,
  );
  return tips.length > 0 ? tips : newestFirst(versions, depths).slice(0, 1);
};

/**
 * Applies the current-version rule to every entity of one table: given all
 * rows of the table and all rows of its InsertHistory companion, returns
 * the current row per entity `id` and the set of `id`s with more than one
 * tip. Pure: reads its arguments and nothing else.
 */
export const currentVersions = <Row extends EntityRow>(
  rows: readonly Row[],
  historyRows: readonly VersionHistoryRow[],
  tableKey: string,
): CurrentVersions<Row> => {
  const currentById = new Map<string, Row>();
  const conflictingIds = new Set<string>();

  for (const [id, versions] of versionsByEntity(rows, historyRows, tableKey)) {
    const tips = tipsOf(versions);
    currentById.set(id, tips[0].row);
    if (tips.length > 1) {
      conflictingIds.add(id);
    }
  }

  return { currentById, conflictingIds };
};

/**
 * The current rows of one table, ordered by `id`: the shape every list
 * endpoint serves. Conflicting entities appear with their newest tip.
 */
export const currentRows = <Row extends EntityRow>(
  rows: readonly Row[],
  historyRows: readonly VersionHistoryRow[],
  tableKey: string,
): Row[] =>
  [...currentVersions(rows, historyRows, tableKey).currentById.values()].sort(
    (left, right) => left.id.localeCompare(right.id),
  );

/**
 * Every version of one entity, newest first, each flagged `current` when
 * it is a tip of the entity's DAG. An `id` the table does not hold gives an
 * empty list. Newest first means by depth in the history and then by
 * `timeId` (`depthsOf`), the same order every node computes for the same
 * history rows.
 */
export const versionsOf = <Row extends EntityRow>(
  rows: readonly Row[],
  historyRows: readonly VersionHistoryRow[],
  tableKey: string,
  id: string,
): EntityVersion<Row>[] => {
  const versions = versionsByEntity(rows, historyRows, tableKey).get(id) ?? [];
  const tipTimeIds = new Set(tipsOf(versions).map((tip) => tip.history.timeId));

  return newestFirst(versions, depthsOf(versions)).map((version) => ({
    row: version.row,
    timeId: version.history.timeId,
    previous: [...(version.history.previous ?? [])],
    current: tipTimeIds.has(version.history.timeId),
  }));
};
