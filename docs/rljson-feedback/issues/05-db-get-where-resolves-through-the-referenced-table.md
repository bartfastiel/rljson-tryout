# `Db.get` with a `where` key that is also a column of a referenced table filters the referenced table, not the table asked for

- Package: `@rljson/db` 0.0.42 (`ComponentController._getByWhere`,
  `_resolveReferenceColumns`, `_referenceColumns`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: silent wrong results (`{ id }` on any table with a `ref` column
  finds nothing)

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
    column('name'),
    column('speciesRef', { ref: { tableKey: 'species', type: 'components' } }),
    column('bornOn'),
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
  animals: {
    _type: 'components',
    _data: [
      { id: 'quackmore', name: 'Quackmore', speciesRef, bornOn: '2022-03-14' },
    ],
  },
});

const count = async (where) =>
  (await db.get(Route.fromFlat('animals'), where)).rljson.animals._data.length;
console.log(
  'animals where { bornOn }: ',
  await count({ bornOn: '2022-03-14' }),
);
console.log('animals where { id }:     ', await count({ id: 'quackmore' }));
console.log('animals where { name }:   ', await count({ name: 'Quackmore' }));
console.log(
  'species where { id }:     ',
  (await db.get(Route.fromFlat('species'), { id: 'duck' })).rljson.species._data
    .length,
);
console.log(
  'animals where { name: "Duck" } (the species name):',
  await count({ name: 'Duck' }),
);
console.log(
  'animals where { id: "duck" } (the species id):    ',
  await count({ id: 'duck' }),
);
const controller = await db.getController('animals');
console.log(
  'animals controller _referenceColumns:',
  controller._referenceColumns.map((c) => c.key),
);
```

## Expected

`where` keys name columns of the table the route addresses. `{ id:
'quackmore' }` on `animals` finds the animal, exactly as `{ bornOn }` does
and as `{ id }` does on `species`.

## Actual

```text
animals where { bornOn }:  1
animals where { id }:      0
animals where { name }:    0
species where { id }:      1
animals where { name: "Duck" } (the species name): 1
animals where { id: "duck" } (the species id):     1
animals controller _referenceColumns: [ '_hash', 'id', 'name' ]
```

`_resolveReferenceColumns` collects the columns of every table a `ref`
column points at, and `_hasReferenceColumns(where)` sends the whole
`where` down the reference path as soon as one key matches one of those
names. The result is a feature (filter `animals` by a column of `species`)
that silently shadows the table's own columns: `id` and `name` exist on
both tables, so `animals` can never be filtered by its own `id` or `name`.
Nothing in the API lets a caller say which table a key means, and the
behaviour is not documented.

## Impact on us

Every entity table of the project has `id` and at least one `ref` column,
so `db.get(route, { id })` is unusable for all of them (found in pull
request #20, confirmed by its reviewer). Every read of the project is a
whole-table `db.get(route, {})` followed by a filter in JavaScript.

## Workaround

Whole-table reads plus in-memory filtering. `{ _hash }` (handled before
the `where` path), `{ speciesRef: <hash> }` and a column the referenced
table does not have (`bornOn`) all work; only colliding names are lost.

## Suggested fix

Treat `where` keys as columns of the addressed table unless they are
qualified (for example `{ 'species.name': 'Duck' }` or `{ speciesRef: {
name: 'Duck' } }`), and document the reference filter. At minimum, prefer
the table's own column when the key exists on both sides.
