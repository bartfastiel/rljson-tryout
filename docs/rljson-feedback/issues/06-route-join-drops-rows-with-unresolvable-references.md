# The route join `table/refTable` silently drops a source row whose reference does not resolve

- Package: `@rljson/db` 0.0.42 (`Db.get` with a two-segment route)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: silent wrong results

## Reproduction

```js
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';

const column = (key, extra = {}) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
  ...extra,
});
const species = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const animals = {
  key: 'animals',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [
    column('_hash'),
    column('id'),
    column('speciesRef', { ref: { tableKey: 'species', type: 'components' } }),
  ],
};

const io = new IoMem();
await io.init();
const db = new Db(io);
await db.core.createTableWithInsertHistory(species);
await db.core.createTableWithInsertHistory(animals);
const [{ speciesRef }] = await db.insert(Route.fromFlat('species'), {
  species: { _type: 'components', _data: [{ id: 'duck', name: 'Duck' }] },
});
await db.insert(Route.fromFlat('animals'), {
  animals: { _type: 'components', _data: [{ id: 'valid', speciesRef }] },
});
await db.insert(Route.fromFlat('animals'), {
  animals: {
    _type: 'components',
    _data: [{ id: 'dangling', speciesRef: 'NoSuchSpeciesHash000000' }],
  },
});

console.log('animals in the table:            ', await io.rowCount('animals'));
const plain = await db.get(Route.fromFlat('animals'), {});
console.log(
  'db.get("animals") rows:          ',
  plain.rljson.animals._data.map((row) => row.id),
);
const joined = await db.get(Route.fromFlat('animals/species'), {});
console.log(
  'db.get("animals/species") rows:  ',
  joined.rljson.animals._data.map((row) => row.id),
);
console.log('tables in the joined container:  ', Object.keys(joined.rljson));
```

## Expected

Both animals in `container.rljson.animals._data`, the dangling one with no
matching species row (an outer join), or an error naming the broken
reference. Neither `Db.insert` nor the store rejects a dangling reference
(issue 16), so the join is where a caller would meet it.

## Actual

```text
animals in the table:             2
db.get("animals") rows:           [ 'valid', 'dangling' ]
db.get("animals/species") rows:   [ 'valid' ]
tables in the joined container:   [ 'animals', 'species' ]
```

The join behaves as an inner join and reports nothing about the row it
left out. A caller cannot tell "no such row" from "one row was dropped
because its reference is broken" without a second, unjoined read.

## Impact on us

`GET /api/animals` must list every animal and show a missing species as
missing rather than hide the animal (pull request #15). The route join was
replaced by two whole-table reads and a `Map` join in JavaScript, which is
the pattern for every join in `packages/node-service/src/store/petShopStore.ts`.

## Workaround

Separate reads per table, join in application code.

## Suggested fix

Make the join an outer join (keep the source row, leave the target absent)
or report dropped rows in the container, and document the semantics either
way.
