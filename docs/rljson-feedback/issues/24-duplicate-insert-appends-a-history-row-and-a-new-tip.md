# Inserting an identical row again through the plain route appends another InsertHistory row with `previous: []`, a new tip

- Package: `@rljson/db` 0.0.42 (`Db.insert`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: to be documented or deduplicated (a retried insert produces a
  branch)

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const species = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(species);

const payload = {
  species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
};
await db.insert(Route.fromFlat('species'), payload);
await db.insert(Route.fromFlat('species'), payload);
await db.insert(Route.fromFlat('species'), payload);

const history = (await db.getInsertHistory('species')).speciesInsertHistory
  ._data;
console.log('species rows:        ', await io.rowCount('species'));
console.log('history rows:        ', history.length);
console.log(
  'history previous:    ',
  JSON.stringify(history.map((row) => row.previous)),
);
console.log(
  'detectDagBranch:     ',
  JSON.stringify(await db.detectDagBranch('species')),
);
```

## Expected

Either an idempotent insert (the row exists, no new history row) or a
documented rule that a repeated plain insert is a new root version.

## Actual

```text
species rows:         1
history rows:         3
history previous:     [[],[],[]]
detectDagBranch:      {"table":"species","type":"dagBranch","detectedAt":1789708735286,"branches":["1789708735284:oNOd","1789708735285:Y-Eq","1789708735285:v4Un"]}
```

The row is deduplicated by content; the history is not. A seed that runs
twice, a retried HTTP request or a peer that re-inserts a received row
through `Db.insert` (instead of writing the received history row) turns
one version into several tips of the same content.

## Impact on us

Seeding checks `rowCount` before it writes; received rows are written
with their received history rows through `Io.write`, never re-inserted
through `Db.insert`; a store write is serialised per process.

## Workaround

Idempotence in application code.

## Suggested fix

Document the rule prominently, or add an option (`{ ifAbsent: true }`)
that skips the history row when the row hash already has one.
