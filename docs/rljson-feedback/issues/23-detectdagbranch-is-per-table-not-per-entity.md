# `Db.detectDagBranch` and the conflict observer report a branch as soon as a table holds two independent entities

- Package: `@rljson/db` 0.0.42 (`Db.detectDagBranch`,
  `registerConflictObserver`), `@rljson/rljson` 0.0.81 (`TableCfg.isHead`
  documentation)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: design limitation worth documenting (the signal is unusable
  as a conflict detector for head tables)

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
const animals = {
  key: 'animals',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(animals);
const insert = (route, id, name) =>
  db.insert(Route.fromFlat(route), {
    animals: { _type: 'components', _data: [{ id, name }] },
  });

const [bowser] = await insert('animals', 'bowser', 'Bowser');
await insert(`animals@${bowser.timeId}`, 'bowser', 'Bowser the Bold');
console.log(
  'one entity, two chained versions:   ',
  JSON.stringify(await db.detectDagBranch('animals')),
);
await insert('animals', 'daphne', 'Daphne');
const conflict = await db.detectDagBranch('animals');
console.log(
  'plus a second, unrelated entity:    ',
  JSON.stringify({ type: conflict?.type, tips: conflict?.branches.length }),
);
const conflicts = [];
db.registerConflictObserver(Route.fromFlat('animals'), (detected) =>
  conflicts.push(detected.type),
);
await insert('animals', 'gadget', 'Gadget');
console.log('conflict observer after a third one:', JSON.stringify(conflicts));
```

## Expected

`TableCfg` documents `id` in a head table as "the stable identity of an
entity across versions" and "same row ids must refer to the same physical
object". A branch detector for such a table should count tips per `id`,
or there should be a per-entity variant.

## Actual

```text
one entity, two chained versions:    null
plus a second, unrelated entity:     {"type":"dagBranch","tips":2}
conflict observer after a third one: ["dagBranch"]
```

Tips are counted over the whole InsertHistory table; a history row carries
the row hash, not the `id`, so the function cannot group by entity as it
stands. With 1 000 independent entities it reports 1 000 tips
(`docs/findings/entity-versions.md`), and the conflict observer fires on
every insert of a new entity.

## Impact on us

The "current version per entity" rule and the per-entity conflict list are
application code (`packages/domain/src/entityVersions.ts`: group history
rows by the `id` of the row they reference, tips per group; about 1.4 ms
for 10 000 history rows). `detectDagBranch` remains a cheap per-table
trigger.

## Workaround

Per-entity rule in application code over the table and its history.

## Suggested fix

`detectDagBranch(table, { by: 'id' })` for head tables (join the history
row to its row once, group by `id`), and a sentence in the documentation
that the plain form is per table.
