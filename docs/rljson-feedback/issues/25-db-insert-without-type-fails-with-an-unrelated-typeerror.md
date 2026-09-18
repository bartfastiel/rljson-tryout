# `Db.insert` without `_type` in the payload fails with `Cannot read properties of undefined (reading '_hash')`

- Package: `@rljson/db` 0.0.42 (`Db._insert`, `Db._writeInsertHistory`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: ergonomics (the first mistake every new user makes gets an
  error that points nowhere)

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

try {
  await db.insert(Route.fromFlat('species'), {
    species: { _data: [{ id: 'duck', name: 'Duck' }] },
  });
  console.log('insert resolved');
} catch (error) {
  console.log('insert threw:', error.constructor.name, '-', error.message);
}
console.log('rows in species after the call:', await io.rowCount('species'));
```

## Expected

An error such as `Db.insert: table "species" in the payload has no _type
(expected "components")`, or the type taken from the table configuration,
which the `Db` knows.

## Actual

```text
insert threw: TypeError - Cannot read properties of undefined (reading '_hash')
rows in species after the call: 0
```

No branch of `_insert` matches a table without `_type`, so nothing is
written and `_writeInsertHistory` dereferences `undefined`.

## Impact on us

Cost an hour in the first slice; `_type` is now set by a helper
everywhere.

## Suggested fix

Validate the payload shape at the top of `insert` and name the missing
field, or default `_type` from `tableCfg.type`.
