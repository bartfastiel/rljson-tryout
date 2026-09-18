# `Db.insert` with several rows in `_data` returns one InsertHistory row per row but persists only the first

- Package: `@rljson/db` 0.0.42 (`Db.insert`, `Db._writeInsertHistory`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: silent data loss (history rows are what versions and the DAG
  are built from)

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

const rows = [
  { id: 'duck', name: 'Duck' },
  { id: 'dog', name: 'Dog' },
  { id: 'chicken', name: 'Chicken' },
];
const returned = await db.insert(Route.fromFlat('species'), {
  species: { _type: 'components', _data: rows },
});
const history = (await db.getInsertHistory('species')).speciesInsertHistory
  ._data;

console.log('rows inserted:          ', await io.rowCount('species'));
console.log('history rows returned:  ', returned.length);
console.log('history rows persisted: ', history.length);
console.log(
  'persisted history refs: ',
  history.map((row) => row.speciesRef),
);
console.log(
  'returned history refs:  ',
  returned.map((row) => row.speciesRef),
);
```

## Expected

Three rows, three history rows persisted, one per row, matching the three
the call returns.

## Actual

```text
rows inserted:           3
history rows returned:   3
history rows persisted:  1
persisted history refs:  [ '2oW5VA_HZnUeUFkgjgvEVy' ]
returned history refs:   [
  '2oW5VA_HZnUeUFkgjgvEVy',
  'BvDpGaVc-o_PFgrmjmpWfK',
  '_PKJNP0sf6d-eYCeOJkM8L'
]
```

`Db._writeInsertHistory` writes `insertHistoryRow[0]` only. The return
value suggests every row got a history entry; two of the three rows have
none, so nothing lists them as a version, no `timeId` can chain a follow-up
version onto them, and `detectDagBranch` never sees them.

## Impact on us

Found while seeding three species in one call (pull request #10, confirmed
by the reviewer). Every write in the project is one row per
`Db.insert`.

## Workaround

One `Db.insert` per row. For bulk seeds the project writes rows and
history rows itself through `Core.import` (issue 15).

## Suggested fix

Write every returned history row, or reject `_data` with more than one row
with a clear error otherwise.
