# `Db.insert` issues the InsertHistory `timeId` itself and offers no way to pass one, so two nodes cannot seed identical history

- Package: `@rljson/db` 0.0.42 (`ComponentController.insert`, `timeId()`
  from `@rljson/rljson` 0.0.81)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: design gap with a data consequence (two nodes seeding the same
  rows hold two tips per entity after their first sync)

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
const seed = async () => {
  const io = new IoMem();
  await io.init();
  const db = new Db(io);
  await db.core.createTableWithInsertHistory(species);
  const [history] = await db.insert(Route.fromFlat('species'), {
    species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
  });
  const stored = (await db.getInsertHistory('species')).speciesInsertHistory
    ._data[0];
  return {
    rowHash: history.speciesRef,
    timeId: history.timeId,
    historyHash: stored._hash,
  };
};
const nodeA = await seed();
const nodeB = await seed();
console.log('node A:', JSON.stringify(nodeA));
console.log('node B:', JSON.stringify(nodeB));
console.log('same row hash:        ', nodeA.rowHash === nodeB.rowHash);
console.log('same history timeId:  ', nodeA.timeId === nodeB.timeId);
console.log('same history row hash:', nodeA.historyHash === nodeB.historyHash);
```

## Expected

An option such as `db.insert(route, tree, { timeId })` (the sibling
`insertTrees` already accepts `previous`), so that a deterministic seed
produces identical history rows everywhere.

## Actual

```text
node A: {"rowHash":"2oW5VA_HZnUeUFkgjgvEVy","timeId":"1789708941285:xKc6","historyHash":"4hKCmy4XXkkN2smMFqWXqA"}
node B: {"rowHash":"2oW5VA_HZnUeUFkgjgvEVy","timeId":"1789708941287:wAMn","historyHash":"Za5iSAARWpct9JqyANyJG3"}
same row hash:         true
same history timeId:   false
same history row hash: false
```

The row is content addressed and identical; the history row is stamped
with `timeId()` inside the controller. Once nodes exchange change sets
that name history rows, each seed entity carries one history row per node
that seeded it, every one with `previous: []`: two tips, the same content
under both, listed as a conflict by any per-entity rule.

## Impact on us

The whole seed (hand-written and generated, up to 24 759 rows) is written
through `Core.import` with `validate: false`, history rows included,
stamped from a fixed epoch plus a counter (`seedTimeId` in
`packages/domain/src/seedTimeId.ts`). That bypasses `Db`'s incremental DAG
tip set and its insert notifications for seeded rows. Two production nodes
that had seeded the old way keep an extra tip per seed entity until their
volumes are emptied, because rljson has no delete.

## Workaround

`Core.import` for rows and hand-built history rows with own `timeId`s.

## Suggested fix

`Db.insert(route, tree, { timeId?, previous? })`, mirroring `insertTrees`.
