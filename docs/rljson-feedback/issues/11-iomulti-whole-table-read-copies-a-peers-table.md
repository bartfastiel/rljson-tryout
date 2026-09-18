# `IoMulti.readRows` with an empty `where` answers from the first layer that has any row and copies that table into the local store

- Package: `@rljson/io` 0.0.78 (`IoMulti.readRows`, write-back)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: surprising data movement (a list request on a node with an
  empty table pulls the hub's whole table and caches it)

## Reproduction

```js
import { IoMem, IoMulti } from '@rljson/io';

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
const store = async (rows) => {
  const io = new IoMem();
  await io.init();
  await io.createOrExtendTable({ tableCfg: species });
  if (rows.length > 0)
    await io.write({ data: { species: { _type: 'components', _data: rows } } });
  return io;
};

const emptyLocal = await store([]);
const bigPeer = await store(
  Array.from({ length: 1000 }, (_, index) => ({
    id: `s-${index}`,
    name: `Species ${index}`,
  })),
);
const multi = new IoMulti([
  { io: emptyLocal, priority: 1, read: true, write: true, dump: true },
  { io: bigPeer, priority: 2, read: true, write: false, dump: false },
]);
await multi.init();
console.log(
  'local rows before a where: {} read: ',
  await emptyLocal.rowCount('species'),
);
const all = await multi.readRows({ table: 'species', where: {} });
console.log('rows the multi answered:            ', all.species._data.length);
console.log(
  'local rows after the where: {} read:',
  await emptyLocal.rowCount('species'),
);
```

## Expected

Either whole-table reads stay local (a cascade is for targeted lookups),
or the behaviour is an explicit option; and a partial local table should
not be answered from the local layer alone while an empty one is answered
from a peer, because the two answers mean different things.

## Actual

```text
local rows before a where: {} read:  0
rows the multi answered:             1000
local rows after the where: {} read: 1000
```

The walk stops at the first priority group that returned any row, and the
result is written into every writable layer that did not answer. With a
local table that holds one row the same call returns that one row and
asks nobody; with an empty local table it returns the peer's whole table
and copies it. The cached rows carry no InsertHistory rows, so anything
that derives "current version" from the history does not see them as
versions, but counts and lists do.

## Impact on us

`GET /api/species` on a freshly started client would have pulled the hub's
tables one by one, and a node's row counts would have depended on which
list a browser opened first.

## Workaround

`packages/node-service/src/store/ioSwitch.ts`: an `Io` facade in front of
the store's `Db` that sends only targeted reads (`where` non-empty)
through the multi and keeps whole-table reads, writes, dumps and counts on
the local store.

## Suggested fix

An option on `IoMulti` (or on `Server`/`Client`) that limits cascading to
targeted reads, and no write-back for whole-table results by default.
