# `Db` has no controller for `buffets`: `Db.insert` and `Db.get` on a buffets table throw

- Package: `@rljson/db` 0.0.42 (`createController`, `Db._insert`);
  `@rljson/rljson` 0.0.81 has no `createBuffetTableCfg`
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: blocker for the buffets content type through `Db`

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';

const column = (key, type = 'string') => ({
  key,
  type,
  titleLong: key,
  titleShort: key,
});
const changeSets = {
  key: 'changeSets',
  type: 'buffets',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('items', 'jsonArray')],
};

const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(changeSets);
console.log(
  'content type of the table:',
  await io.contentType({ table: 'changeSets' }),
);

const row = {
  id: 'change-1',
  items: [{ table: 'invoices', ref: 'SomeInvoiceHash0000000' }],
};
for (const [label, call] of [
  [
    'db.insert',
    () =>
      db.insert(Route.fromFlat('changeSets'), {
        changeSets: { _type: 'buffets', _data: [row] },
      }),
  ],
  ['db.get   ', () => db.get(Route.fromFlat('changeSets'), {})],
]) {
  try {
    await call();
    console.log(label, 'resolved');
  } catch (error) {
    console.log(label, 'threw:', error.message);
  }
}
await db.core.import(
  { changeSets: { _type: 'buffets', _data: [row] } },
  { validate: false },
);
const read = await io.readRows({ table: 'changeSets', where: {} });
console.log(
  'rows via core.import + io.readRows:',
  read.changeSets._data.length,
);
```

## Expected

A `buffets` table is part of the format (`Buffet`, `BuffetsTable`, the
bakery example), `IoMem` creates it and `BaseValidator` checks its items,
so `Db.insert` and `Db.get` should handle it like `components`, `cakes`,
`layers`, `sliceIds` and `trees`.

## Actual

```text
content type of the table: buffets
db.insert threw: Controller for type buffets is not implemented yet.
db.get    threw: Controller for type buffets is not implemented yet.
rows via core.import + io.readRows: 1
```

`createController` has cases for `layers`, `components` (with `edits`,
`editHistory`, `multiEdits`, `insertHistory`), `cakes`, `sliceIds` and
`trees`; `Db._insert` has no branch for `buffets` either. There is also no
`createBuffetTableCfg` next to `createCakeTableCfg`,
`createLayerTableCfg`, `createSliceIdsTableCfg` and `createTreesTableCfg`,
so the `items` column is spelled out by hand.

## Impact on us

The change set table of the project (one row per business operation,
`items: [{ table, ref }]`, roadmap section 3.4) is a buffets table. Every
write of it goes through `Core.import` with `validate: false` and every
read through `Io.readRows`, bypassing `Db` and its observers
(`recordChangeSet`, `readChangeSets` in
`packages/node-service/src/store/petShopStore.ts`).

## Workaround

`db.core.import(payload, { validate: false })` for the row and its
InsertHistory row, `io.readRows` for reads.

## Suggested fix

A `BuffetController` (insert, get by `_hash`, `id` and `where`) and a
`createBuffetTableCfg(key)` factory.
